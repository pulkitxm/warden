export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ManagerDetection {
  manager: PackageManager;
  source: "invoked" | "packageManager" | "lockfile" | "config" | "available" | "default";
  evidence: string;
}

export interface ManagerFs {
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  which: (cmd: string) => string | null;
}

const LOCKFILES: Array<{ file: string; manager: PackageManager }> = [
  { file: "package-lock.json", manager: "npm" },
  { file: "npm-shrinkwrap.json", manager: "npm" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
];

const NAMES: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

function fromPackageManagerField(fs: ManagerFs, dir: string): ManagerDetection | null {
  let raw: string;
  try {
    raw = fs.readFile(`${dir}/package.json`);
  } catch {
    return null;
  }
  let field: string | undefined;
  try {
    field = (JSON.parse(raw) as { packageManager?: string }).packageManager;
  } catch {
    return null;
  }
  if (!field) return null;
  const name = field.split("@")[0] as PackageManager;
  if (!NAMES.includes(name)) return null;
  return {
    manager: name,
    source: "packageManager",
    evidence: `package.json packageManager=${field}`,
  };
}

function fromLockfile(fs: ManagerFs, dir: string): ManagerDetection | null {
  for (const entry of LOCKFILES) {
    if (fs.exists(`${dir}/${entry.file}`))
      return { manager: entry.manager, source: "lockfile", evidence: entry.file };
  }
  return null;
}

function fromConfig(fs: ManagerFs, dir: string): ManagerDetection | null {
  let raw: string;
  try {
    raw = fs.readFile(`${dir}/warden.config.json`);
  } catch {
    return null;
  }
  try {
    const name = (JSON.parse(raw) as { packageManager?: string }).packageManager as PackageManager;
    if (NAMES.includes(name))
      return { manager: name, source: "config", evidence: "warden.config.json packageManager" };
  } catch {
    return null;
  }
  return null;
}

export function detectManager(fs: ManagerFs, dir: string, invoked?: string): ManagerDetection {
  if (invoked && NAMES.includes(invoked as PackageManager)) {
    return {
      manager: invoked as PackageManager,
      source: "invoked",
      evidence: `invoked as ${invoked}`,
    };
  }

  const detected = fromPackageManagerField(fs, dir) ?? fromLockfile(fs, dir) ?? fromConfig(fs, dir);
  if (detected) return detected;

  const available = NAMES.find((name) => fs.which(name));
  if (available)
    return { manager: available, source: "available", evidence: `${available} found on PATH` };

  return { manager: "npm", source: "default", evidence: "no signal; defaulting to npm" };
}

export const MANAGER_NAMES: readonly PackageManager[] = NAMES;

export const MANAGER_OPTIONS: Record<PackageManager, { type: "boolean" }> = {
  npm: { type: "boolean" },
  pnpm: { type: "boolean" },
  yarn: { type: "boolean" },
  bun: { type: "boolean" },
};

export function hoistManagerFlags(argv: string[]): string[] {
  const flags = NAMES.map((name) => `--${name}`);
  const named = argv.filter((arg) => flags.includes(arg));
  if (!named.length) return argv;
  return [...argv.filter((arg) => !flags.includes(arg)), ...named];
}

export function managerFlag(values: Record<string, unknown>): PackageManager | undefined {
  return NAMES.find((name) => values[name] === true);
}

export function execCommand(manager: PackageManager, spec: string, args: string[] = []): string[] {
  if (manager === "bun") return ["bunx", spec, ...args];
  if (manager === "npm") return ["npx", spec, ...args];
  return [manager, "dlx", spec, ...args];
}

export function installCommand(
  manager: PackageManager,
  packages: string[],
  suppressScripts: boolean,
): string[] {
  const verb = manager === "npm" || !packages.length ? "install" : "add";
  const args = [manager, verb, ...packages];
  if (!suppressScripts) return args;
  if (manager === "npm" || manager === "pnpm" || manager === "bun") args.push("--ignore-scripts");
  return args;
}
