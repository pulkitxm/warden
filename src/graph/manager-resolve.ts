import { join } from "node:path";
import { LOCK_FORMATS, UNREADABLE_LOCKFILES } from "../lockfile.ts";
import type { PackageManager } from "../shared/manager.ts";
import { progressStep } from "../shared/progress.ts";
import type { InstalledNode } from "./delta.ts";
import { type InstalledFs, readInstalledGraph } from "./installed.ts";
import type { TransactionRequest } from "./request.ts";

export interface ManagerResolveDeps extends InstalledFs {
  exec: (cmd: string[], cwd: string, env?: Record<string, string>) => { code: number };
  mkTemp: () => string;
  copyFile: (from: string, to: string) => void;
  rm: (path: string) => void;
  which: (cmd: string) => string | null;
}

export interface ManagerResolution {
  nodes: Map<string, InstalledNode>;
  lockfile: string;
}

const SEED_FILES = [
  "package.json",
  ...LOCK_FORMATS.map((format) => format.file),
  ...UNREADABLE_LOCKFILES.map((entry) => entry.file),
  ".npmrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
  "bunfig.toml",
];

export function lockfileOnlyCommand(
  manager: PackageManager,
  request: TransactionRequest,
): string[] | null {
  const specs = request.specs;
  if (manager === "npm") {
    const verb = specs.length ? ["install", ...specs] : ["install"];
    return ["npm", ...verb, "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"];
  }
  if (manager === "pnpm") {
    const verb = specs.length ? ["add", ...specs] : ["install"];
    return ["pnpm", ...verb, "--lockfile-only", "--ignore-scripts"];
  }
  if (manager === "yarn") {
    if (specs.length) return null;
    return ["yarn", "install", "--mode=update-lockfile"];
  }
  const verb = specs.length ? ["add", ...specs] : ["install"];
  return ["bun", ...verb, "--lockfile-only", "--ignore-scripts"];
}

export function resolveWithManager(
  manager: PackageManager,
  request: TransactionRequest,
  root: string,
  deps: ManagerResolveDeps,
): ManagerResolution | null {
  const command = lockfileOnlyCommand(manager, request);
  if (!command) return null;
  if (!deps.which(manager)) return null;

  const workspace = deps.mkTemp();
  try {
    let seeded = false;
    for (const name of SEED_FILES) {
      const from = join(root, name);
      if (!deps.exists(from)) continue;
      try {
        deps.copyFile(from, join(workspace, name));
        if (name === "package.json") seeded = true;
      } catch {}
    }
    if (!seeded) return null;

    progressStep(`resolving with ${manager}, without running package code`);
    const env: Record<string, string> = manager === "yarn" ? { YARN_ENABLE_SCRIPTS: "0" } : {};
    if (deps.exec(command, workspace, env).code !== 0) return null;

    const resolved = readInstalledGraph(deps, workspace);
    if (resolved.source === "none" || !resolved.nodes.size) return null;
    return { nodes: resolved.nodes, lockfile: resolved.source };
  } catch {
    return null;
  } finally {
    try {
      deps.rm(workspace);
    } catch {
      progressStep("the temporary resolution workspace could not be removed");
    }
  }
}
