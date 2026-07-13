import { dirname, join } from "node:path";
import * as walk from "acorn-walk";
import { curatedSurface } from "./api-db.ts";
import { parseProgram, toParseable } from "./source.ts";
import type { ApiSurface, HallucinationFinding } from "./types.ts";

export interface Binding {
  pkg: string;
  kind: "default" | "namespace" | "named";
  imported?: string;
  instanceOf?: string;
}

export interface MemberAccess {
  name: string;
  member: string;
  line: number;
}

export interface SurfaceIo {
  readFile: (path: string) => string;
}

const PROTOTYPE_SKIP = new Set([
  "then",
  "catch",
  "finally",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "call",
  "apply",
  "bind",
  "constructor",
  "length",
  "name",
  "prototype",
]);

function isBare(spec: string): boolean {
  return spec.length > 0 && !spec.startsWith(".") && !spec.startsWith("/");
}

export function bindingsFromAst(program: unknown): Record<string, Binding> {
  const bindings: Record<string, Binding> = {};
  walk.simple(program as any, {
    ImportDeclaration(node: any) {
      const spec = String(node.source?.value ?? "");
      if (!isBare(spec)) return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type === "ImportDefaultSpecifier") {
          bindings[specifier.local.name] = { pkg: spec, kind: "default" };
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          bindings[specifier.local.name] = { pkg: spec, kind: "namespace" };
        } else if (specifier.type === "ImportSpecifier") {
          bindings[specifier.local.name] = {
            pkg: spec,
            kind: "named",
            imported: specifier.imported?.name ?? specifier.local.name,
          };
        }
      }
    },
    VariableDeclarator(node: any) {
      const init = node.init;
      if (init?.type !== "CallExpression" || init.callee?.name !== "require") return;
      const arg = init.arguments?.[0];
      if (arg?.type !== "Literal" || typeof arg.value !== "string" || !isBare(arg.value)) return;
      if (node.id?.type === "Identifier") {
        bindings[node.id.name] = { pkg: arg.value, kind: "namespace" };
      } else if (node.id?.type === "ObjectPattern") {
        for (const property of node.id.properties ?? []) {
          if (
            property.type === "Property" &&
            property.key?.type === "Identifier" &&
            property.value?.type === "Identifier"
          ) {
            bindings[property.value.name] = {
              pkg: arg.value,
              kind: "named",
              imported: property.key.name,
            };
          }
        }
      }
    },
  });
  return bindings;
}

const IMPORT_DEFAULT_RE = /import\s+([\w$]+)\s*(?:,\s*\{[^}]*\})?\s+from\s*["']([^"']+)["']/;
const IMPORT_NS_RE = /import\s*\*\s*as\s+([\w$]+)\s+from\s*["']([^"']+)["']/;
const IMPORT_NAMED_RE = /import\s*(?:[\w$]+\s*,\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/;
const REQUIRE_RE = /(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/;
const REQUIRE_NAMED_RE = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/;

function namedBindings(list: string, pkg: string, sep: RegExp): Record<string, Binding> {
  const bindings: Record<string, Binding> = {};
  for (const item of list.split(",")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const [original, alias] = trimmed.split(sep).map((part) => part.trim());
    if (!original) continue;
    bindings[alias || original] = { pkg, kind: "named", imported: original };
  }
  return bindings;
}

export function bindingsFromText(code: string): Record<string, Binding> {
  const bindings: Record<string, Binding> = {};
  for (const line of code.split("\n")) {
    const ns = line.match(IMPORT_NS_RE);
    if (ns && isBare(ns[2]!)) bindings[ns[1]!] = { pkg: ns[2]!, kind: "namespace" };
    const named = line.match(IMPORT_NAMED_RE);
    if (named && isBare(named[2]!)) {
      Object.assign(bindings, namedBindings(named[1]!, named[2]!, /\s+as\s+/));
    }
    const dflt = !ns && line.match(IMPORT_DEFAULT_RE);
    if (dflt && isBare(dflt[2]!)) bindings[dflt[1]!] = { pkg: dflt[2]!, kind: "default" };
    const req = line.match(REQUIRE_RE);
    if (req && isBare(req[2]!)) bindings[req[1]!] = { pkg: req[2]!, kind: "namespace" };
    const reqNamed = line.match(REQUIRE_NAMED_RE);
    if (reqNamed && isBare(reqNamed[2]!)) {
      Object.assign(bindings, namedBindings(reqNamed[1]!, reqNamed[2]!, /\s*:\s*/));
    }
  }
  return bindings;
}

const FACTORY_RE =
  /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:new\s+)?([\w$]+)(?:\.([\w$]+))?\s*\(/;

export function propagateInstances(
  code: string,
  bindings: Record<string, Binding>,
  surfaceOf: (pkg: string) => ApiSurface | null,
): Record<string, Binding> {
  const out = { ...bindings };
  for (const line of code.split("\n")) {
    const match = line.match(FACTORY_RE);
    if (!match) continue;
    const [, target, base, method] = match;
    const binding = out[base!];
    if (!binding || binding.instanceOf) continue;
    const surface = surfaceOf(binding.pkg);
    if (!surface) continue;
    const factory =
      method ?? (binding.kind === "named" ? (binding.imported ?? base!) : "(call)");
    const key = Object.keys(surface.instances).find((candidate) =>
      surface.instances[candidate]!.via.includes(factory),
    );
    if (key) out[target!] = { pkg: binding.pkg, kind: binding.kind, instanceOf: key };
  }
  return out;
}

const ACCESS_RE = /([\w$]+)\.([\w$]+)/g;

function stripNoise(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

export function memberAccesses(code: string): MemberAccess[] {
  const out: MemberAccess[] = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = stripNoise(lines[i]!);
    for (const match of line.matchAll(ACCESS_RE)) {
      const rest = line.slice(match.index! + match[0].length);
      if (/^\s*=(?!=)/.test(rest)) continue;
      out.push({ name: match[1]!, member: match[2]!, line: i + 1 });
    }
  }
  return out;
}

interface Extraction {
  root: Set<string>;
  closed: boolean;
  hop: string | null;
}

function objectProps(node: any): { names: string[]; open: boolean } {
  const names: string[] = [];
  let open = false;
  for (const property of node.properties ?? []) {
    if (property.type === "SpreadElement" || property.computed) open = true;
    else if (property.key?.type === "Identifier") names.push(property.key.name);
    else if (property.key?.type === "Literal") names.push(String(property.key.value));
    else open = true;
  }
  return { names, open };
}

function isModuleExports(node: any): boolean {
  return (
    node?.type === "MemberExpression" &&
    node.object?.name === "module" &&
    node.property?.name === "exports"
  );
}

export function collectExports(program: unknown): Extraction {
  const root = new Set<string>();
  let closed = true;
  let hop: string | null = null;
  const objectVars = new Map<string, any>();
  walk.simple(program as any, {
    VariableDeclarator(node: any) {
      if (node.id?.type === "Identifier" && node.init?.type === "ObjectExpression") {
        objectVars.set(node.id.name, node.init);
      }
    },
  });
  const mergeObject = (node: any) => {
    const { names, open } = objectProps(node);
    for (const name of names) root.add(name);
    if (open) closed = false;
  };
  walk.simple(program as any, {
    ExportAllDeclaration() {
      closed = false;
    },
    ExportNamedDeclaration(node: any) {
      const decl = node.declaration;
      if (decl?.id?.name) root.add(decl.id.name);
      for (const declarator of decl?.declarations ?? []) {
        if (declarator.id?.type === "Identifier") root.add(declarator.id.name);
      }
      for (const specifier of node.specifiers ?? []) {
        if (specifier.exported?.name) root.add(specifier.exported.name);
      }
    },
    ExportDefaultDeclaration(node: any) {
      root.add("default");
      const decl = node.declaration;
      const object =
        decl?.type === "ObjectExpression"
          ? decl
          : decl?.type === "Identifier"
            ? objectVars.get(decl.name)
            : undefined;
      if (object) mergeObject(object);
    },
    AssignmentExpression(node: any) {
      const left = node.left;
      if (isModuleExports(left)) {
        const right = node.right;
        if (right?.type === "ObjectExpression") mergeObject(right);
        else if (
          right?.type === "CallExpression" &&
          right.callee?.name === "require" &&
          right.arguments?.[0]?.type === "Literal"
        ) {
          hop = String(right.arguments[0].value);
        } else if (right?.type === "Identifier" && objectVars.has(right.name)) {
          mergeObject(objectVars.get(right.name));
        } else {
          closed = false;
        }
      } else if (
        left?.type === "MemberExpression" &&
        isModuleExports(left.object) &&
        left.property?.name
      ) {
        root.add(left.property.name);
      } else if (
        left?.type === "MemberExpression" &&
        left.object?.name === "exports" &&
        left.property?.name
      ) {
        root.add(left.property.name);
      }
    },
    CallExpression(node: any) {
      const callee = node.callee;
      if (
        callee?.type === "MemberExpression" &&
        callee.object?.name === "Object" &&
        ["assign", "defineProperty", "defineProperties"].includes(callee.property?.name)
      ) {
        const target = node.arguments?.[0];
        if (isModuleExports(target) || target?.name === "exports") closed = false;
      }
    },
  });
  return { root, closed, hop };
}

function entryOf(pkgJson: { exports?: unknown; main?: unknown }): string {
  const exp = pkgJson.exports;
  let candidate: unknown =
    typeof exp === "object" && exp !== null && "." in (exp as Record<string, unknown>)
      ? (exp as Record<string, unknown>)["."]
      : exp;
  for (let level = 0; level < 2; level++) {
    if (typeof candidate !== "object" || candidate === null) break;
    const conditions = candidate as Record<string, unknown>;
    candidate = conditions.require ?? conditions.default ?? conditions.import;
  }
  if (typeof candidate === "string") return candidate.replace(/^\.\//, "");
  if (typeof pkgJson.main === "string") return pkgJson.main.replace(/^\.\//, "");
  return "index.js";
}

function loadModule(
  baseDir: string,
  rel: string,
  io: SurfaceIo,
): { program: unknown; dir: string } | null {
  for (const candidate of [rel, `${rel}.js`, `${rel}/index.js`]) {
    const path = join(baseDir, candidate);
    let code: string;
    try {
      code = io.readFile(path);
    } catch {
      continue;
    }
    const program = parseProgram(code);
    if (!program) return null;
    return { program, dir: dirname(path) };
  }
  return null;
}

export function extractSurface(pkg: string, root: string, io: SurfaceIo): ApiSurface | null {
  if (pkg.startsWith("node:")) return null;
  const base = join(root, "node_modules", pkg);
  let entry: string;
  try {
    entry = entryOf(
      JSON.parse(io.readFile(join(base, "package.json"))) as { exports?: unknown; main?: unknown },
    );
  } catch {
    return null;
  }
  if (/\.(node|json)$/.test(entry)) return null;
  const first = loadModule(base, entry, io);
  if (!first) return null;
  let extraction = collectExports(first.program);
  if (extraction.hop) {
    const hopped = loadModule(first.dir, extraction.hop, io);
    if (!hopped) return null;
    const hopExtraction = collectExports(hopped.program);
    if (hopExtraction.hop) return null;
    extraction = {
      root: new Set([...extraction.root, ...hopExtraction.root]),
      closed: extraction.closed && hopExtraction.closed,
      hop: null,
    };
  }
  if (!extraction.root.size) return null;
  return { root: [...extraction.root].sort(), instances: {}, closed: extraction.closed };
}

function membersFor(binding: Binding, localName: string, surface: ApiSurface): string[] | null {
  if (binding.instanceOf) return surface.instances[binding.instanceOf]?.members ?? null;
  if (binding.kind === "named") {
    return surface.instances[binding.imported ?? localName]?.members ?? null;
  }
  return surface.root;
}

function describeBinding(binding: Binding): string {
  if (binding.instanceOf) return `${binding.pkg} ${binding.instanceOf}`;
  if (binding.kind === "named") return `${binding.pkg}.${binding.imported}`;
  return binding.pkg;
}

function proofFor(
  binding: Binding,
  member: string,
  members: string[],
  from: "curated" | "node_modules",
): string {
  const shown = members.slice(0, 12).join(", ");
  const more = members.length > 12 ? ", …" : "";
  const origin = from === "curated" ? "curated signature db" : "extracted from node_modules";
  return `${describeBinding(binding)} has no member '${member}'. Known: ${shown}${more} (${origin})`;
}

export function findHallucinations(
  files: Map<string, { code: string; addedLines: Set<number> }>,
  root: string,
  io: SurfaceIo,
): HallucinationFinding[] {
  const cache = new Map<string, { surface: ApiSurface; from: "curated" | "node_modules" } | null>();
  const lookup = (pkg: string) => {
    if (!cache.has(pkg)) {
      const curated = curatedSurface(pkg);
      if (curated) cache.set(pkg, { surface: curated, from: "curated" });
      else {
        const extracted = extractSurface(pkg, root, io);
        cache.set(pkg, extracted ? { surface: extracted, from: "node_modules" } : null);
      }
    }
    return cache.get(pkg) ?? null;
  };
  const surfaceOf = (pkg: string): ApiSurface | null => lookup(pkg)?.surface ?? null;
  const out: HallucinationFinding[] = [];
  const seen = new Set<string>();
  for (const [file, { code, addedLines }] of files) {
    const parsed = toParseable(code, file);
    const program = parseProgram(parsed.code);
    const bindings = propagateInstances(
      code,
      program ? bindingsFromAst(program) : bindingsFromText(code),
      surfaceOf,
    );
    for (const access of memberAccesses(code)) {
      if (!addedLines.has(access.line)) continue;
      const binding = bindings[access.name];
      if (!binding || PROTOTYPE_SKIP.has(access.member)) continue;
      const resolved = lookup(binding.pkg);
      if (!resolved || !resolved.surface.closed) continue;
      const members = membersFor(binding, access.name, resolved.surface);
      if (!members || members.includes(access.member)) continue;
      const key = `${binding.pkg}:${access.member}:${file}:${access.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        symbol: `${binding.pkg}.${binding.instanceOf ?? "root"}.${access.member}`,
        package: binding.pkg,
        file,
        line: access.line,
        proof: proofFor(binding, access.member, members, resolved.from),
        source: resolved.from,
      });
    }
  }
  return out;
}
