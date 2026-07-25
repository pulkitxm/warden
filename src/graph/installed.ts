import { join } from "node:path";
import {
  entriesFromNpmLock,
  entriesFromPnpmLock,
  entriesFromYarnLock,
  type LockEntry,
} from "../audit/lockfile.ts";
import type { InstalledNode } from "./delta.ts";
import { LIFECYCLE_HOOKS } from "./resolve.ts";

export interface InstalledFs {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
}

const PARSERS: Array<{ file: string; parse: (text: string) => LockEntry[] }> = [
  { file: "package-lock.json", parse: entriesFromNpmLock },
  { file: "npm-shrinkwrap.json", parse: entriesFromNpmLock },
  { file: "pnpm-lock.yaml", parse: entriesFromPnpmLock },
  { file: "yarn.lock", parse: entriesFromYarnLock },
];

export interface InstalledGraph {
  nodes: Map<string, InstalledNode>;
  source: string;
}

function hooksFromManifest(fs: InstalledFs, root: string, name: string): string[] | undefined {
  const manifest = join(root, "node_modules", ...name.split("/"), "package.json");
  if (!fs.exists(manifest)) return undefined;
  try {
    const scripts = (JSON.parse(fs.readFile(manifest)) as { scripts?: Record<string, string> })
      .scripts;
    if (!scripts) return [];
    return LIFECYCLE_HOOKS.filter((hook) => typeof scripts[hook] === "string");
  } catch {
    return undefined;
  }
}

export function readInstalledGraph(fs: InstalledFs, root: string): InstalledGraph {
  for (const parser of PARSERS) {
    const path = join(root, parser.file);
    if (!fs.exists(path)) continue;
    let entries: LockEntry[];
    try {
      entries = parser.parse(fs.readFile(path));
    } catch {
      continue;
    }
    const nodes = new Map<string, InstalledNode>();
    for (const entry of entries) {
      if (!entry.name || !entry.version || nodes.has(entry.name)) continue;
      const hooks = hooksFromManifest(fs, root, entry.name);
      nodes.set(entry.name, { version: entry.version, ...(hooks ? { hooks } : {}) });
    }
    if (nodes.size) return { nodes, source: parser.file };
  }
  return { nodes: new Map(), source: "none" };
}

export function manifestRequirements(
  fs: InstalledFs,
  root: string,
): Array<{ name: string; range: string; optional?: boolean }> {
  const path = join(root, "package.json");
  if (!fs.exists(path)) return [];
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(fs.readFile(path));
  } catch {
    return [];
  }
  const out: Array<{ name: string; range: string; optional?: boolean }> = [];
  for (const [name, range] of Object.entries(manifest.dependencies ?? {}))
    out.push({ name, range });
  for (const [name, range] of Object.entries(manifest.devDependencies ?? {}))
    out.push({ name, range });
  for (const [name, range] of Object.entries(manifest.optionalDependencies ?? {}))
    out.push({ name, range, optional: true });
  return out;
}
