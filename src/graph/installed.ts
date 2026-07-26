import { join } from "node:path";
import { type LockEntry, lockfilesIn } from "../lockfile.ts";
import type { InstalledNode } from "./delta.ts";
import { INSTALL_HOOKS } from "./resolve.ts";

export interface InstalledFs {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
}

export interface InstalledGraph {
  nodes: Map<string, InstalledNode>;
  source: string;
}

export function installedIdentities(graph: InstalledGraph): Array<{
  name: string;
  version: string;
  integrity?: string;
  resolved?: string;
}> {
  return [...graph.nodes.entries()].map(([name, node]) => ({
    name,
    version: node.version,
    ...(node.integrity ? { integrity: node.integrity } : {}),
    ...(node.resolved ? { resolved: node.resolved } : {}),
  }));
}

function hooksFromManifest(fs: InstalledFs, root: string, name: string): string[] | undefined {
  const manifest = join(root, "node_modules", ...name.split("/"), "package.json");
  if (!fs.exists(manifest)) return undefined;
  try {
    const scripts = (JSON.parse(fs.readFile(manifest)) as { scripts?: Record<string, string> })
      .scripts;
    if (!scripts) return [];
    return INSTALL_HOOKS.filter((hook) => typeof scripts[hook] === "string");
  } catch {
    return undefined;
  }
}

export function readInstalledGraph(fs: InstalledFs, root: string): InstalledGraph {
  for (const format of lockfilesIn(fs, root)) {
    let entries: LockEntry[];
    try {
      entries = format.parse(fs.readFile(join(root, format.file)));
    } catch {
      continue;
    }
    const nodes = new Map<string, InstalledNode>();
    for (const entry of entries) {
      if (!entry.name || !entry.version || nodes.has(entry.name)) continue;
      const hooks = hooksFromManifest(fs, root, entry.name);
      nodes.set(entry.name, {
        version: entry.version,
        ...(hooks ? { hooks } : {}),
        ...(entry.integrity ? { integrity: entry.integrity } : {}),
        ...(entry.resolved ? { resolved: entry.resolved } : {}),
      });
    }
    if (nodes.size) return { nodes, source: format.file };
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
