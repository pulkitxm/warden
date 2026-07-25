import { createHash } from "node:crypto";
import { diffLevel } from "../semver.ts";
import type { GraphNode, GraphResolution } from "./resolve.ts";

export interface GraphChange {
  name: string;
  version: string;
  from?: string;
  level?: "none" | "patch" | "minor" | "major";
  direct: boolean;
  hooks: string[];
  newHooks: string[];
  deprecated: boolean;
  platformSpecific: boolean;
  requiredBy: string[];
}

export interface GraphDelta {
  added: GraphChange[];
  changed: GraphChange[];
  removed: Array<{ name: string; version: string }>;
  unchanged: number;
  scriptSurface: GraphChange[];
  newScriptSurface: GraphChange[];
  platformArtifacts: GraphChange[];
  deprecatedIntroduced: GraphChange[];
}

export interface InstalledNode {
  version: string;
  hooks?: string[];
}

function toChange(node: GraphNode, before: InstalledNode | undefined): GraphChange {
  const previousHooks = new Set(before?.hooks ?? []);
  const newHooks = before ? node.hooks.filter((hook) => !previousHooks.has(hook)) : node.hooks;
  return {
    name: node.name,
    version: node.version,
    ...(before ? { from: before.version, level: diffLevel(before.version, node.version) } : {}),
    direct: node.depth === 0,
    hooks: node.hooks,
    newHooks,
    deprecated: node.deprecated,
    platformSpecific: node.platformSpecific,
    requiredBy: node.requiredBy,
  };
}

export function graphDelta(
  resolution: GraphResolution,
  installed: Map<string, InstalledNode>,
): GraphDelta {
  const added: GraphChange[] = [];
  const changed: GraphChange[] = [];
  let unchanged = 0;

  for (const node of resolution.nodes) {
    const before = installed.get(node.name);
    if (!before) {
      added.push(toChange(node, undefined));
      continue;
    }
    if (before.version === node.version) {
      unchanged++;
      continue;
    }
    changed.push(toChange(node, before));
  }

  const resolvedNames = new Set(resolution.nodes.map((node) => node.name));
  const removed = [...installed.entries()]
    .filter(([name]) => !resolvedNames.has(name))
    .map(([name, node]) => ({ name, version: node.version }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const touched = [...added, ...changed];
  return {
    added,
    changed,
    removed,
    unchanged,
    scriptSurface: touched.filter((entry) => entry.hooks.length),
    newScriptSurface: touched.filter((entry) => entry.newHooks.length),
    platformArtifacts: touched.filter((entry) => entry.platformSpecific),
    deprecatedIntroduced: touched.filter((entry) => entry.deprecated),
  };
}

export function digestGraph(entries: Array<{ name: string; version: string }>): string {
  const canonical = [...entries]
    .map((entry) => `${entry.name}@${entry.version}`)
    .sort()
    .join("\n");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
