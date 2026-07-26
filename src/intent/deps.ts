import { join } from "node:path";
import { defaultHallucinated } from "../intel/index.ts";
import { isNodeBuiltin } from "./api-db.ts";
import type { DependencyFinding, IntentPipelineDeps } from "./types.ts";

const SPEC_RE = /(?:from\s*|import\s*|require\(\s*)["']([^"']+)["']/g;

const MANIFEST_GROUPS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export interface AddedImport {
  spec: string;
  file: string;
  line: number;
}

export function packageNameOf(spec: string): string | null {
  if (spec === "" || spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("#") || /^[a-z]+:/.test(spec)) return null;
  const parts = spec.split("/");
  if (spec.startsWith("@")) {
    if (parts.length < 2 || parts[1] === "") return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? null;
}

export function collectAddedImports(
  files: Map<string, { code: string; addedLines: Set<number> }>,
): AddedImport[] {
  const out: AddedImport[] = [];
  const seen = new Set<string>();
  for (const [file, { code, addedLines }] of files) {
    const lines = code.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!addedLines.has(index + 1)) continue;
      for (const match of lines[index]!.matchAll(SPEC_RE)) {
        const spec = match[1]!;
        const key = `${file}:${index + 1}:${spec}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ spec, file, line: index + 1 });
      }
    }
  }
  return out;
}

export function declaredPackages(deps: IntentPipelineDeps, root: string): Set<string> | null {
  let raw: string;
  try {
    raw = deps.readFile(join(root, "package.json"));
  } catch {
    return null;
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const declared = new Set<string>();
  if (typeof manifest.name === "string") declared.add(manifest.name);
  for (const group of MANIFEST_GROUPS) {
    const entry = manifest[group];
    if (typeof entry !== "object" || entry === null) continue;
    for (const name of Object.keys(entry as Record<string, unknown>)) declared.add(name);
  }
  return declared;
}

function installed(deps: IntentPipelineDeps, root: string, name: string): boolean {
  try {
    deps.readFile(join(root, "node_modules", name, "package.json"));
    return true;
  } catch {
    return false;
  }
}

export interface DependencyScan {
  findings: DependencyFinding[];
  notes: string[];
}

export async function scanDependencies(
  files: Map<string, { code: string; addedLines: Set<number> }>,
  root: string,
  deps: IntentPipelineDeps,
  packageExists?: (name: string) => Promise<boolean | null>,
): Promise<DependencyScan> {
  const declared = declaredPackages(deps, root);
  if (!declared) {
    return {
      findings: [],
      notes: ["undeclared imports not checked: no readable package.json at the repository root"],
    };
  }
  const findings: DependencyFinding[] = [];
  const notes: string[] = [];
  const unresolved: string[] = [];
  const judged = new Set<string>();

  for (const entry of collectAddedImports(files)) {
    const name = packageNameOf(entry.spec);
    if (name === null || isNodeBuiltin(entry.spec) || declared.has(name)) continue;
    if (judged.has(name)) continue;
    judged.add(name);
    if (defaultHallucinated.has(name)) {
      findings.push({
        package: name,
        file: entry.file,
        line: entry.line,
        rule: "known_hallucinated_name",
        level: "block",
        proof: `"${name}" is on warden's curated list of package names language models invent`,
        fix: `remove the import, or name the real package you meant`,
      });
      continue;
    }
    const onDisk = installed(deps, root, name);
    findings.push({
      package: name,
      file: entry.file,
      line: entry.line,
      rule: "undeclared_import",
      level: "warn",
      proof: onDisk
        ? `"${name}" is imported on an added line and installed, but no dependency group in package.json declares it`
        : `"${name}" is imported on an added line and is neither declared in package.json nor present in node_modules`,
      fix: `add "${name}" to package.json, or remove the import`,
    });
    if (!onDisk) unresolved.push(name);
  }

  if (unresolved.length && !packageExists) {
    notes.push(
      `registry existence not checked for ${unresolved.length} unresolved import(s) (${unresolved.join(", ")}): no registry lookup was available`,
    );
  }
  for (const name of unresolved) {
    if (!packageExists) break;
    let exists: boolean | null;
    try {
      exists = await packageExists(name);
    } catch {
      exists = null;
    }
    if (exists === null) {
      notes.push(`registry existence not checked for "${name}": the lookup did not answer`);
      continue;
    }
    if (exists) continue;
    const row = findings.find((finding) => finding.package === name);
    if (row) {
      row.rule = "unpublished_package";
      row.level = "block";
      row.proof = `"${name}" does not exist on the registry, so this import can never resolve`;
      row.fix = `remove the import; a name that has never been published is the slopsquat shape`;
    }
  }
  return { findings, notes };
}
