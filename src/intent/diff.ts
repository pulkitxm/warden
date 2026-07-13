import { basename } from "node:path";
import { parseProgram, toParseable } from "./source.ts";
import type { ClassifiedHunk, FileDiff, HunkCategory, RawHunk } from "./types.ts";

const JS_RE = /\.[cm]?[jt]sx?$/;
const TEST_DOC_PATH_RE = /(^|\/)(tests?|__tests__|docs?)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const DOC_FILE_RE = /\.(md|txt)$/i;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: RawHunk | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { file: "", binary: false, added: false, deleted: false, hunks: [] };
      const provisional = line.match(/ b\/(.+)$/);
      if (provisional) current.file = provisional[1]!;
      files.push(current);
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path !== "/dev/null") current.file = path.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.renamedFrom = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("new file mode")) {
      current.added = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.deleted = true;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }
    const header = line.match(HUNK_HEADER_RE);
    if (header) {
      hunk = {
        file: current.file,
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk && /^[ +\-\\]/.test(line)) hunk.lines.push(line);
    else hunk = null;
  }
  return files;
}

function addedLineNumbers(hunk: RawHunk): Set<number> {
  const set = new Set<number>();
  let cursor = hunk.newStart;
  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      set.add(cursor);
      cursor++;
    } else if (line.startsWith(" ")) cursor++;
  }
  return set;
}

export function addedLineSets(diffs: FileDiff[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const diff of diffs) {
    const set = map.get(diff.file) ?? new Set<number>();
    map.set(diff.file, set);
    for (const hunk of diff.hunks) {
      for (const line of addedLineNumbers(hunk)) set.add(line);
    }
  }
  return map;
}

export interface Decl {
  name: string;
  kind: "function" | "class" | "method" | "variable";
  lineStart: number;
  lineEnd: number;
}

export function indexDeclarations(code: string): Decl[] {
  const program = parseProgram(code);
  if (!program) return [];
  const decls: Decl[] = [];
  const push = (name: string, kind: Decl["kind"], node: any) => {
    decls.push({ name, kind, lineStart: node.loc.start.line, lineEnd: node.loc.end.line });
  };
  for (const raw of (program as any).body ?? []) {
    const node =
      raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
        ? (raw.declaration ?? raw)
        : raw;
    if (node.type === "FunctionDeclaration" && node.id?.name) {
      push(node.id.name, "function", node);
    } else if (node.type === "ClassDeclaration" && node.id?.name) {
      push(node.id.name, "class", node);
      for (const item of node.body?.body ?? []) {
        if (item.type === "MethodDefinition" && item.key?.name) {
          push(`${node.id.name}.${item.key.name}`, "method", item);
        }
      }
    } else if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations ?? []) {
        if (declarator.id?.type !== "Identifier") continue;
        const isFn =
          declarator.init?.type === "ArrowFunctionExpression" ||
          declarator.init?.type === "FunctionExpression";
        push(declarator.id.name, isFn ? "function" : "variable", node);
      }
    }
  }
  return decls;
}

const DECL_LINE_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=)/;

function braceEnd(lines: string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") depth--;
    }
    if (!seen || depth <= 0) return i + 1;
  }
  return lines.length;
}

export function declsFromText(code: string): Decl[] {
  const lines = code.split("\n");
  const decls: Decl[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(DECL_LINE_RE);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3]!;
    const kind = match[1] ? "function" : match[2] ? "class" : "variable";
    decls.push({ name, kind, lineStart: i + 1, lineEnd: braceEnd(lines, i) });
  }
  return decls;
}

function declsFor(diff: FileDiff, readFile: (path: string) => string): Decl[] {
  if (diff.deleted || !JS_RE.test(diff.file)) return [];
  let code: string;
  try {
    code = readFile(diff.file);
  } catch {
    return [];
  }
  const parsed = toParseable(code, diff.file);
  if (parsed.exact) {
    const decls = indexDeclarations(parsed.code);
    if (decls.length) return decls;
  }
  return declsFromText(code);
}

const IMPORT_SPEC_RE = /import\b[^"']*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/;

function importSpecs(lines: string[]): string[] {
  const specs = new Set<string>();
  for (const line of lines) {
    const match = line.match(IMPORT_SPEC_RE);
    if (match) specs.add(match[1] ?? match[2]!);
  }
  return [...specs];
}

function stripped(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/\s+/g, ""))
    .filter(Boolean)
    .sort();
}

function categorize(
  diff: FileDiff,
  added: string[],
  removed: string[],
  decls: Decl[],
  addedSet: Set<number>,
  lineStart: number,
  lineEnd: number,
): HunkCategory {
  if (diff.deleted || (added.length === 0 && removed.length > 0)) return "deletion";
  if (
    TEST_DOC_PATH_RE.test(diff.file) ||
    TEST_FILE_RE.test(diff.file) ||
    DOC_FILE_RE.test(diff.file)
  ) {
    return "test_or_doc";
  }
  if (
    added.length > 0 &&
    removed.length > 0 &&
    JSON.stringify(stripped(added)) === JSON.stringify(stripped(removed))
  ) {
    return "formatting_only";
  }
  if (!JS_RE.test(diff.file)) return "other";
  const addedImports = added.some((line) => IMPORT_SPEC_RE.test(line));
  const removedImports = removed.some((line) => IMPORT_SPEC_RE.test(line));
  if (addedImports) return "import_added";
  if (removedImports) return "import_removed";
  const functionDecls = decls.filter((decl) => decl.kind !== "variable");
  const fullyAdded = (decl: Decl) => {
    for (let line = decl.lineStart; line <= decl.lineEnd; line++) {
      if (!addedSet.has(line)) return false;
    }
    return true;
  };
  const newFn = functionDecls.some(
    (decl) => decl.lineStart >= lineStart && decl.lineEnd <= lineEnd && fullyAdded(decl),
  );
  if (newFn) return "new_function";
  const signature = functionDecls.some((decl) => addedSet.has(decl.lineStart));
  if (signature && removed.some((line) => line.includes("("))) return "signature_change";
  if (added.some((line) => /\b(if|else|switch|case|while|for)\b|\?.*:/.test(line))) {
    return "conditional_changed";
  }
  const assignments = added.filter((line) => /[^=!<>]=[^=]/.test(line)).length;
  if (added.length > 0 && assignments * 2 > added.length) return "assignment_changed";
  return "other";
}

export function classifyHunks(
  diffs: FileDiff[],
  readFile: (path: string) => string,
): ClassifiedHunk[] {
  const out: ClassifiedHunk[] = [];
  let counter = 0;
  for (const diff of diffs) {
    if (diff.binary) continue;
    const decls = declsFor(diff, readFile);
    for (const hunk of diff.hunks) {
      counter++;
      const added = hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
      const removed = hunk.lines
        .filter((line) => line.startsWith("-"))
        .map((line) => line.slice(1));
      const lineStart = hunk.newStart;
      const span = hunk.lines.filter((line) => /^[ +]/.test(line)).length;
      const lineEnd = hunk.newStart + Math.max(0, span - 1);
      const addedSet = addedLineNumbers(hunk);
      const category = categorize(diff, added, removed, decls, addedSet, lineStart, lineEnd);
      const symbols = [
        ...new Set(
          decls
            .filter((decl) => decl.lineStart <= lineEnd && decl.lineEnd >= lineStart)
            .map((decl) => decl.name),
        ),
      ];
      const summary = `${category} ${symbols.slice(0, 3).join(", ") || basename(diff.file)}`;
      out.push({
        id: `h${counter}`,
        file: diff.file,
        lineStart,
        lineEnd,
        category,
        summary,
        symbols,
        imports: importSpecs([...added, ...removed]),
        addedLines: added.length,
      });
    }
  }
  return out;
}

export function symbolScanFiles(
  diffs: FileDiff[],
  readFile: (path: string) => string,
): Map<string, { code: string; addedLines: Set<number> }> {
  const added = addedLineSets(diffs);
  const files = new Map<string, { code: string; addedLines: Set<number> }>();
  for (const diff of diffs) {
    if (diff.binary || diff.deleted || !JS_RE.test(diff.file)) continue;
    const lines = added.get(diff.file);
    if (!lines?.size) continue;
    try {
      files.set(diff.file, { code: readFile(diff.file), addedLines: lines });
    } catch {
      continue;
    }
  }
  return files;
}
