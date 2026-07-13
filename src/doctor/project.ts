import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectFs {
  readFile(path: string): string;
  exists(path: string): boolean;
}

export const defaultProjectFs: ProjectFs = {
  readFile: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
};

export interface ProjectDependency {
  name: string;
  range: string;
  group: "prod" | "dev";
  installed?: string;
}

export interface Project {
  dir: string;
  name: string;
  scripts: Record<string, string>;
  deps: ProjectDependency[];
  packageManager: "bun" | "npm";
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockFile {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
}

function lockVersion(dir: string, name: string, fs: ProjectFs): string | undefined {
  try {
    const lock = JSON.parse(fs.readFile(join(dir, "package-lock.json"))) as LockFile;
    return lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version;
  } catch {
    return undefined;
  }
}

export function installedVersion(
  dir: string,
  name: string,
  fs: ProjectFs = defaultProjectFs,
): string | undefined {
  const fromLock = lockVersion(dir, name, fs);
  if (fromLock) return fromLock;
  try {
    const pkg = JSON.parse(fs.readFile(join(dir, "node_modules", name, "package.json"))) as {
      version?: string;
    };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export function loadProject(dir: string, fs: ProjectFs = defaultProjectFs): Project {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(fs.readFile(join(dir, "package.json"))) as PackageJson;
  } catch (e) {
    throw new Error(`could not read package.json in "${dir}": ${(e as Error).message}`);
  }
  const deps: ProjectDependency[] = [];
  const groups: Array<["prod" | "dev", Record<string, string> | undefined]> = [
    ["prod", pkg.dependencies],
    ["dev", pkg.devDependencies],
  ];
  for (const [group, map] of groups) {
    for (const [name, range] of Object.entries(map ?? {})) {
      if (deps.some((d) => d.name === name)) continue;
      deps.push({
        name,
        range: String(range),
        group,
        installed: installedVersion(dir, name, fs),
      });
    }
  }
  const packageManager =
    fs.exists(join(dir, "bun.lock")) || fs.exists(join(dir, "bun.lockb")) ? "bun" : "npm";
  return { dir, name: pkg.name ?? "project", scripts: pkg.scripts ?? {}, deps, packageManager };
}
