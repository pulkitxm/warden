import { expect, test } from "bun:test";
import {
  COVERAGE_MATRIX,
  type CommandKind,
  classifySpec,
  type Manager,
  planCommand,
  SUPPRESS_ENV,
  SUPPRESS_FLAGS,
  UNSUPPORTED_PATHS,
} from "../../src/shim/grammar.ts";

const kind = (manager: Manager, argv: string[]) => planCommand(manager, argv).kind;

const INSTALL_CASES: Array<[Manager, string[]]> = [
  ["npm", ["install"]],
  ["npm", ["i"]],
  ["npm", ["add", "lodash"]],
  ["npm", ["update"]],
  ["pnpm", ["install"]],
  ["pnpm", ["add", "zod"]],
  ["pnpm", ["up"]],
  ["yarn", ["install"]],
  ["yarn", ["add", "hono"]],
  ["bun", ["install"]],
  ["bun", ["add", "elysia"]],
];

for (const [manager, argv] of INSTALL_CASES) {
  test(`${manager} ${argv.join(" ")} is an install`, () => {
    expect(kind(manager, argv)).toBe("install");
  });
}

const FROZEN_CASES: Array<[Manager, string[]]> = [
  ["npm", ["ci"]],
  ["npm", ["clean-install"]],
  ["npm", ["install-ci-test"]],
  ["npm", ["cit"]],
  ["pnpm", ["install", "--frozen-lockfile"]],
  ["yarn", ["install", "--immutable"]],
  ["bun", ["install", "--frozen-lockfile"]],
];

for (const [manager, argv] of FROZEN_CASES) {
  test(`${manager} ${argv.join(" ")} is a frozen install and a graph transaction`, () => {
    const plan = planCommand(manager, argv);
    expect(plan.kind).toBe("frozen-install");
    expect(plan.graphTransaction).toBe(true);
  });
}

test("npm ci is mediated, which was the largest coverage gap", () => {
  const plan = planCommand("npm", ["ci"]);
  expect(plan.coverage).toBe("protected");
  expect(plan.suppressScripts).toContain("--ignore-scripts");
});

const EXEC_CASES: Array<[Manager, string[], string]> = [
  ["npx", ["create-vite"], "create-vite"],
  ["npx", ["-y", "create-vite"], "create-vite"],
  ["npx", ["--package", "cowsay", "cowsay"], "cowsay"],
  ["bunx", ["cowsay"], "cowsay"],
  ["npm", ["exec", "cowsay"], "cowsay"],
  ["npm", ["x", "cowsay"], "cowsay"],
  ["pnpm", ["dlx", "cowsay"], "cowsay"],
  ["pnpm", ["exec", "cowsay"], "cowsay"],
  ["yarn", ["dlx", "cowsay"], "cowsay"],
  ["bun", ["x", "cowsay"], "cowsay"],
  ["bun", ["create", "vite"], "vite"],
];

for (const [manager, argv, expected] of EXEC_CASES) {
  test(`${manager} ${argv.join(" ")} is an exec of ${expected}`, () => {
    const plan = planCommand(manager, argv);
    expect(plan.kind).toBe("exec");
    expect(plan.specs).toEqual([expected]);
  });
}

const REBUILD_CASES: Array<[Manager, string[]]> = [
  ["npm", ["rebuild"]],
  ["pnpm", ["rebuild"]],
  ["pnpm", ["approve-builds"]],
  ["yarn", ["rebuild"]],
];

for (const [manager, argv] of REBUILD_CASES) {
  test(`${manager} ${argv.join(" ")} is mediated because rebuild re-runs scripts`, () => {
    expect(kind(manager, argv)).toBe("rebuild");
  });
}

test("global installs are classified separately from project installs", () => {
  expect(kind("npm", ["install", "-g", "typescript"])).toBe("global-install");
  expect(kind("npm", ["install", "--global", "typescript"])).toBe("global-install");
  expect(planCommand("npm", ["install", "-g", "typescript"]).specs).toEqual(["typescript"]);
});

const PASSTHROUGH: Array<[Manager, string[]]> = [
  ["npm", ["run", "build"]],
  ["npm", ["test"]],
  ["npm", ["publish"]],
  ["npm", ["whoami"]],
  ["pnpm", ["run", "dev"]],
  ["yarn", ["workspaces", "list"]],
  ["bun", ["run", "index.ts"]],
  ["npm", []],
];

for (const [manager, argv] of PASSTHROUGH) {
  test(`${manager} ${argv.join(" ") || "<empty>"} passes through untouched`, () => {
    const plan = planCommand(manager, argv);
    expect(plan.kind).toBe("passthrough");
    expect(plan.specs).toEqual([]);
    expect(plan.suppressScripts).toEqual([]);
  });
}

test("an install with no package arguments is a graph transaction", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    expect(planCommand(manager, ["install"]).graphTransaction).toBe(true);
  }
});

test("an install with package arguments is not a graph transaction", () => {
  expect(planCommand("npm", ["install", "lodash"]).graphTransaction).toBe(false);
});

const EXOTIC: Array<[string, string]> = [
  ["git+ssh://git@github.com/a/b.git", "git"],
  ["git+https://github.com/a/b.git", "git"],
  ["git://github.com/a/b.git", "git"],
  ["github:user/repo", "git"],
  ["user/repo", "git"],
  ["https://example.com/pkg.tgz", "remote"],
  ["http://example.com/pkg.tgz", "remote"],
  ["file:../local", "file"],
  ["./local", "file"],
  ["../local", "file"],
  ["/abs/local", "file"],
  ["link:../x", "file"],
  ["portal:../x", "file"],
  ["workspace:*", "workspace"],
];

for (const [spec, source] of EXOTIC) {
  test(`${spec} is classified as ${source}, never silently skipped`, () => {
    expect(classifySpec(spec)).toBe(source as never);
    const plan = planCommand("npm", ["install", spec]);
    expect(plan.exotic.map((entry) => entry.spec)).toContain(spec);
    expect(plan.specs).not.toContain(spec);
  });
}

const REGISTRY_SPECS = [
  "lodash",
  "@fastify/jwt",
  "lodash@4.17.21",
  "@scope/pkg@1.0.0",
  "hono@latest",
];

for (const spec of REGISTRY_SPECS) {
  test(`${spec} is a registry spec`, () => {
    expect(classifySpec(spec)).toBe("registry");
    expect(planCommand("npm", ["install", spec]).specs).toContain(spec);
  });
}

test("flag values are never mistaken for package specs", () => {
  const plan = planCommand("pnpm", ["add", "--filter", "web", "zod", "--registry", "https://r/"]);
  expect(plan.specs).toEqual(["zod"]);
  expect(plan.exotic).toEqual([]);
});

test("bare flags are ignored", () => {
  expect(planCommand("npm", ["install", "--save-dev", "typescript"]).specs).toEqual(["typescript"]);
});

test("script suppression uses each manager's native control", () => {
  expect(SUPPRESS_FLAGS.npm).toContain("--ignore-scripts");
  expect(SUPPRESS_FLAGS.pnpm).toContain("--ignore-scripts");
  expect(SUPPRESS_ENV.yarn?.YARN_ENABLE_SCRIPTS).toBe("0");
  expect(SUPPRESS_FLAGS.bun).toEqual([]);
});

test("exec never suppresses scripts, because the point is to run the tool", () => {
  for (const [manager, argv] of EXEC_CASES) {
    const plan = planCommand(manager, argv);
    expect(plan.suppressScripts).toEqual([]);
    expect(plan.suppressEnv).toEqual({});
  }
});

test("every install and rebuild path carries a suppression control or documents why not", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const plan = planCommand(manager, ["install"]);
    const hasControl = plan.suppressScripts.length > 0 || Object.keys(plan.suppressEnv).length > 0;
    if (manager === "bun") expect(hasControl).toBe(false);
    else expect(hasControl).toBe(true);
  }
});

test("the coverage matrix names every mediated command", () => {
  const kinds = new Set<CommandKind>(COVERAGE_MATRIX.map((row) => row.kind));
  expect(kinds.has("install")).toBe(true);
  expect(kinds.has("frozen-install")).toBe(true);
  expect(kinds.has("exec")).toBe(true);
  expect(kinds.has("rebuild")).toBe(true);
  expect(COVERAGE_MATRIX.some((row) => row.manager === "npm" && row.command === "ci")).toBe(true);
});

test("the matrix agrees with the parser for every listed row", () => {
  for (const row of COVERAGE_MATRIX) {
    if (row.command.startsWith("<")) continue;
    const argv = row.command.split(" ");
    expect(planCommand(row.manager, argv).kind).toBe(row.kind);
  }
});

test("unsupported paths are documented rather than silently claimed", () => {
  expect(UNSUPPORTED_PATHS.length).toBeGreaterThan(0);
  for (const entry of UNSUPPORTED_PATHS) {
    expect(entry.path.length).toBeGreaterThan(5);
    expect(entry.reason.length).toBeGreaterThan(10);
  }
  const text = UNSUPPORTED_PATHS.map((entry) => entry.path).join(" ");
  expect(text).toContain("absolute");
  expect(text).toContain("Corepack");
});
