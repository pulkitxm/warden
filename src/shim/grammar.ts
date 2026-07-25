export type Manager = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "bunx";

export type CommandKind =
  | "install"
  | "frozen-install"
  | "exec"
  | "rebuild"
  | "global-install"
  | "passthrough";

export type Coverage = "protected" | "observed" | "unsupported" | "not-applicable";

export interface ExoticSpec {
  spec: string;
  source: "git" | "remote" | "file" | "workspace";
}

export interface CommandPlan {
  manager: Manager;
  kind: CommandKind;
  specs: string[];
  exotic: ExoticSpec[];
  graphTransaction: boolean;
  suppressScripts: string[];
  suppressEnv: Record<string, string>;
  coverage: Coverage;
}

const VALUE_FLAGS = new Set([
  "--workspace",
  "-w",
  "--filter",
  "-F",
  "--registry",
  "--tag",
  "--cache",
  "--prefix",
  "--cwd",
  "--dir",
  "-C",
]);

const EXEC_PACKAGE_FLAGS = new Set(["--package", "-p"]);

const INSTALL_VERBS: Record<string, string[]> = {
  npm: ["install", "i", "add", "update", "up", "upgrade"],
  pnpm: ["install", "i", "add", "update", "up"],
  yarn: ["install", "i", "add", "up", "upgrade"],
  bun: ["install", "i", "add", "update"],
};

const FROZEN_VERBS: Record<string, Array<{ verb: string; flag?: string }>> = {
  npm: [{ verb: "ci" }, { verb: "clean-install" }, { verb: "install-ci-test" }, { verb: "cit" }],
  pnpm: [{ verb: "install", flag: "--frozen-lockfile" }],
  yarn: [{ verb: "install", flag: "--immutable" }],
  bun: [{ verb: "install", flag: "--frozen-lockfile" }],
};

const EXEC_VERBS: Record<string, string[]> = {
  npm: ["exec", "x"],
  pnpm: ["dlx", "exec"],
  yarn: ["dlx", "exec"],
  bun: ["x", "create"],
};

const REBUILD_VERBS: Record<string, string[]> = {
  npm: ["rebuild"],
  pnpm: ["rebuild", "approve-builds"],
  yarn: ["rebuild"],
  bun: ["pm"],
};

export const SUPPRESS_FLAGS: Record<string, string[]> = {
  npm: ["--ignore-scripts"],
  pnpm: ["--ignore-scripts"],
  yarn: [],
  bun: [],
};

export const SUPPRESS_ENV: Record<string, Record<string, string>> = {
  npm: {},
  pnpm: {},
  yarn: { YARN_ENABLE_SCRIPTS: "0" },
  bun: {},
};

export function classifySpec(spec: string): ExoticSpec["source"] | "registry" {
  if (/^(git\+|git:|ssh:)/.test(spec) || /^github:/.test(spec)) return "git";
  if (/^https?:/.test(spec)) return "remote";
  if (/^(file:|link:|portal:)/.test(spec) || /^\.{1,2}\//.test(spec) || spec.startsWith("/"))
    return "file";
  if (/^workspace:/.test(spec)) return "workspace";
  if (/^[^@/]+\/[^@/]+$/.test(spec) && !spec.startsWith("@")) return "git";
  return "registry";
}

function isFlag(arg: string): boolean {
  return arg.startsWith("-");
}

function collectExecSpecs(args: string[]): { specs: string[]; exotic: ExoticSpec[] } {
  const specs: string[] = [];
  const exotic: ExoticSpec[] = [];
  let takeNext = false;
  for (const arg of args) {
    if (takeNext) {
      takeNext = false;
      const source = classifySpec(arg);
      if (source === "registry") specs.push(arg);
      else exotic.push({ spec: arg, source });
      break;
    }
    if (EXEC_PACKAGE_FLAGS.has(arg)) {
      takeNext = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) continue;
    if (isFlag(arg)) continue;
    const source = classifySpec(arg);
    if (source === "registry") specs.push(arg);
    else exotic.push({ spec: arg, source });
    break;
  }
  return { specs, exotic };
}

function collectSpecs(args: string[]): { specs: string[]; exotic: ExoticSpec[] } {
  const specs: string[] = [];
  const exotic: ExoticSpec[] = [];
  let skip = false;
  for (const arg of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      skip = true;
      continue;
    }
    if (isFlag(arg)) continue;
    const source = classifySpec(arg);
    if (source === "registry") specs.push(arg);
    else exotic.push({ spec: arg, source });
  }
  return { specs, exotic };
}

function hasFrozenFlag(args: string[]): boolean {
  return args.some((arg) =>
    ["--frozen-lockfile", "--immutable", "--frozen", "--no-save"].includes(arg),
  );
}

function hasGlobalFlag(args: string[]): boolean {
  return args.some((arg) => ["-g", "--global"].includes(arg));
}

export function planCommand(manager: Manager, argv: string[]): CommandPlan {
  const base = {
    manager,
    suppressScripts: SUPPRESS_FLAGS[manager] ?? [],
    suppressEnv: SUPPRESS_ENV[manager] ?? {},
  };

  if (manager === "npx" || manager === "bunx") {
    const { specs, exotic } = collectExecSpecs(argv);
    return {
      ...base,
      suppressScripts: [],
      suppressEnv: {},
      kind: "exec",
      specs: specs.slice(0, 1),
      exotic,
      graphTransaction: false,
      coverage: "protected",
    };
  }

  const verb = argv[0] ?? "";
  const rest = argv.slice(1);
  const { specs, exotic } = collectSpecs(rest);

  if ((EXEC_VERBS[manager] ?? []).includes(verb)) {
    const exec = collectExecSpecs(rest);
    return {
      ...base,
      suppressScripts: [],
      suppressEnv: {},
      kind: "exec",
      specs: exec.specs.slice(0, 1),
      exotic: exec.exotic,
      graphTransaction: false,
      coverage: "protected",
    };
  }

  if ((REBUILD_VERBS[manager] ?? []).includes(verb)) {
    return {
      ...base,
      kind: "rebuild",
      specs,
      exotic,
      graphTransaction: false,
      coverage: "protected",
    };
  }

  const frozenMatch = (FROZEN_VERBS[manager] ?? []).some(
    (entry) => entry.verb === verb && (!entry.flag || rest.includes(entry.flag)),
  );
  if (frozenMatch) {
    return {
      ...base,
      kind: "frozen-install",
      specs,
      exotic,
      graphTransaction: true,
      coverage: "protected",
    };
  }

  if ((INSTALL_VERBS[manager] ?? []).includes(verb)) {
    if (hasGlobalFlag(rest)) {
      return {
        ...base,
        kind: "global-install",
        specs,
        exotic,
        graphTransaction: false,
        coverage: "protected",
      };
    }
    const frozen = hasFrozenFlag(rest);
    return {
      ...base,
      kind: frozen ? "frozen-install" : "install",
      specs,
      exotic,
      graphTransaction: specs.length === 0,
      coverage: "protected",
    };
  }

  return {
    ...base,
    suppressScripts: [],
    suppressEnv: {},
    kind: "passthrough",
    specs: [],
    exotic: [],
    graphTransaction: false,
    coverage: "not-applicable",
  };
}

export interface CoverageRow {
  manager: Manager;
  command: string;
  kind: CommandKind;
  coverage: Coverage;
  note: string;
}

export const COVERAGE_MATRIX: CoverageRow[] = [
  ...(["npm", "pnpm", "yarn", "bun"] as const).flatMap((manager) => [
    ...(INSTALL_VERBS[manager] ?? []).map((command) => ({
      manager,
      command,
      kind: "install" as const,
      coverage: "protected" as const,
      note: "package specs vetted before delegation; scripts suppressed where the manager supports it",
    })),
    ...(FROZEN_VERBS[manager] ?? []).map((entry) => ({
      manager,
      command: entry.flag ? `${entry.verb} ${entry.flag}` : entry.verb,
      kind: "frozen-install" as const,
      coverage: "protected" as const,
      note: "graph transaction; the lockfile is audited before delegation",
    })),
    ...(EXEC_VERBS[manager] ?? []).map((command) => ({
      manager,
      command,
      kind: "exec" as const,
      coverage: "protected" as const,
      note: "the executed package is vetted before it runs",
    })),
    ...(REBUILD_VERBS[manager] ?? []).map((command) => ({
      manager,
      command,
      kind: "rebuild" as const,
      coverage: "protected" as const,
      note: "rebuild re-runs install scripts, so it is mediated",
    })),
  ]),
  {
    manager: "npx",
    command: "<package>",
    kind: "exec",
    coverage: "protected",
    note: "the executed package is vetted before it runs",
  },
  {
    manager: "bunx",
    command: "<package>",
    kind: "exec",
    coverage: "protected",
    note: "the executed package is vetted before it runs",
  },
];

export const UNSUPPORTED_PATHS: Array<{ path: string; reason: string }> = [
  {
    path: "absolute executable paths, for example /usr/local/bin/npm install",
    reason: "PATH shims are not on the resolution path when a manager is invoked by absolute path",
  },
  {
    path: "Corepack-managed shims",
    reason:
      "Corepack resolves its own binaries; run warden integrations doctor to see whether the shim wins",
  },
  {
    path: "package managers invoked inside a container or devcontainer",
    reason: "the container has its own PATH; install Warden inside the image to mediate it",
  },
  {
    path: "arbitrary shell downloads piped to an interpreter",
    reason: "outside the package-manager grammar entirely; CI receipt verification is the backstop",
  },
  {
    path: "Windows and PowerShell",
    reason: "the installer and shims target macOS and Linux shells today",
  },
];
