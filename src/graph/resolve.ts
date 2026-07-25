import { maxSatisfying, satisfies } from "../semver.ts";
import { progressCount, progressDetail } from "../shared/progress.ts";

export const LIFECYCLE_HOOKS = ["preinstall", "install", "postinstall", "prepare", "prepublish"];

export interface PackumentVersion {
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  deprecated?: string | boolean;
  dist?: { tarball?: string; integrity?: string };
  os?: string[];
  cpu?: string[];
}

export interface Packument {
  name: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
}

export interface GraphNode {
  name: string;
  version: string;
  integrity?: string;
  tarball?: string;
  hooks: string[];
  depth: number;
  requiredBy: string[];
  optional: boolean;
  deprecated: boolean;
  platformSpecific: boolean;
}

export interface UnresolvedNode {
  name: string;
  range: string;
  reason: string;
  requiredBy: string;
  optional: boolean;
}

export interface GraphResolution {
  nodes: GraphNode[];
  unresolved: UnresolvedNode[];
  conflicts: Array<{ name: string; selected: string; alsoRequired: string; requiredBy: string }>;
  truncated: boolean;
  complete: boolean;
}

export interface ResolveDeps {
  packument: (name: string) => Promise<Packument | null>;
  maxNodes?: number;
}

export interface RootRequirement {
  name: string;
  range: string;
  optional?: boolean;
}

const DEFAULT_MAX_NODES = 750;

function selectVersion(pack: Packument, range: string): string | null {
  const versions = Object.keys(pack.versions ?? {});
  if (!versions.length) return null;
  const tagged = pack["dist-tags"]?.[range];
  if (tagged && pack.versions?.[tagged]) return tagged;
  if (range === "" || range === "*" || range === "latest") {
    return pack["dist-tags"]?.latest ?? maxSatisfying(versions, "*") ?? null;
  }
  if (pack.versions?.[range]) return range;
  return maxSatisfying(versions, range) ?? null;
}

function hooksOf(scripts: Record<string, string> | undefined): string[] {
  if (!scripts) return [];
  return LIFECYCLE_HOOKS.filter(
    (hook) => typeof scripts[hook] === "string" && scripts[hook] !== "",
  );
}

function isRegistryRange(range: string): boolean {
  return !/^(git|git\+|github:|https?:|file:|link:|workspace:|npm:|portal:)/i.test(range);
}

export async function resolveGraph(
  roots: RootRequirement[],
  deps: ResolveDeps,
): Promise<GraphResolution> {
  const maxNodes = deps.maxNodes ?? DEFAULT_MAX_NODES;
  const selected = new Map<string, GraphNode>();
  const unresolved: UnresolvedNode[] = [];
  const conflicts: GraphResolution["conflicts"] = [];
  const packuments = new Map<string, Packument | null>();
  let truncated = false;

  const load = async (name: string): Promise<Packument | null> => {
    if (packuments.has(name)) return packuments.get(name) ?? null;
    let pack: Packument | null = null;
    try {
      pack = await deps.packument(name);
    } catch {
      pack = null;
    }
    packuments.set(name, pack);
    return pack;
  };

  interface Pending {
    name: string;
    range: string;
    depth: number;
    requiredBy: string;
    optional: boolean;
  }
  const queue: Pending[] = roots.map((root) => ({
    name: root.name,
    range: root.range,
    depth: 0,
    requiredBy: "",
    optional: Boolean(root.optional),
  }));

  while (queue.length) {
    const item = queue.shift() as Pending;
    if (!isRegistryRange(item.range)) {
      unresolved.push({
        name: item.name,
        range: item.range,
        reason: "not a registry range",
        requiredBy: item.requiredBy,
        optional: item.optional,
      });
      continue;
    }

    const existing = selected.get(item.name);
    if (existing) {
      if (item.requiredBy && !existing.requiredBy.includes(item.requiredBy))
        existing.requiredBy.push(item.requiredBy);
      existing.depth = Math.min(existing.depth, item.depth);
      if (!item.optional) existing.optional = false;
      if (item.range !== "" && !satisfies(existing.version, item.range)) {
        conflicts.push({
          name: item.name,
          selected: existing.version,
          alsoRequired: item.range,
          requiredBy: item.requiredBy || "root",
        });
      }
      continue;
    }

    if (selected.size >= maxNodes) {
      truncated = true;
      continue;
    }

    progressCount(selected.size, selected.size + queue.length + 1);
    progressDetail(`reading ${item.name}`);
    const pack = await load(item.name);
    if (!pack?.versions) {
      unresolved.push({
        name: item.name,
        range: item.range,
        reason: "not found on the registry",
        requiredBy: item.requiredBy,
        optional: item.optional,
      });
      continue;
    }

    const version = selectVersion(pack, item.range);
    const meta = version ? pack.versions[version] : undefined;
    if (!version || !meta) {
      unresolved.push({
        name: item.name,
        range: item.range,
        reason: "no published version satisfies the range",
        requiredBy: item.requiredBy,
        optional: item.optional,
      });
      continue;
    }

    selected.set(item.name, {
      name: item.name,
      version,
      integrity: meta.dist?.integrity,
      tarball: meta.dist?.tarball,
      hooks: hooksOf(meta.scripts),
      depth: item.depth,
      requiredBy: item.requiredBy ? [item.requiredBy] : [],
      optional: item.optional,
      deprecated: Boolean(meta.deprecated),
      platformSpecific: Boolean(meta.os?.length || meta.cpu?.length),
    });

    const label = `${item.name}@${version}`;
    for (const [dep, range] of Object.entries(meta.dependencies ?? {}))
      queue.push({ name: dep, range, depth: item.depth + 1, requiredBy: label, optional: false });
    for (const [dep, range] of Object.entries(meta.optionalDependencies ?? {}))
      queue.push({ name: dep, range, depth: item.depth + 1, requiredBy: label, optional: true });
  }

  const nodes = [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
  const blocking = unresolved.filter((entry) => !entry.optional);
  return { nodes, unresolved, conflicts, truncated, complete: !truncated && !blocking.length };
}
