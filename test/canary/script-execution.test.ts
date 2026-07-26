import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTransaction } from "../../src/graph/apply.ts";
import { hashScript } from "../../src/graph/approvals.ts";
import type { GraphChange } from "../../src/graph/delta.ts";
import type { TransactionPlan } from "../../src/graph/plan.ts";
import { installCommand } from "../../src/shared/manager.ts";

const npm = Bun.which("npm");
const CANARY = "warden-canary-executed";

let root = "";

function makeCanaryDependency(dir: string) {
  const pkgDir = join(dir, "canary-pkg");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "install.js"),
    `require("node:fs").writeFileSync(require("node:path").join(__dirname, "..", "${CANARY}"), "ran");\n`,
  );
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "canary-pkg",
      version: "1.0.0",
      scripts: { preinstall: "node install.js", postinstall: "node install.js" },
    }),
  );
  return pkgDir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "warden-canary-"));
  makeCanaryDependency(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "canary-host",
      version: "1.0.0",
      dependencies: { "canary-pkg": "file:./canary-pkg" },
    }),
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const canaryPath = () => join(root, CANARY);

const change: GraphChange = {
  name: "canary-pkg",
  version: "1.0.0",
  direct: true,
  hooks: ["preinstall", "postinstall"],
  newHooks: ["preinstall", "postinstall"],
  deprecated: false,
  platformSpecific: false,
  requiredBy: [],
};

function plan(over: Partial<TransactionPlan> = {}): TransactionPlan {
  return {
    schema_version: 1,
    plan_id: "wtxn_canary",
    command: "npm install",
    manager: "npm",
    root,
    direct: [],
    graph_before: "sha256:before",
    graph_after: "sha256:after",
    delta: {
      added: [change],
      changed: [],
      removed: [],
      unchanged: 0,
      scriptSurface: [change],
      newScriptSurface: [change],
      platformArtifacts: [],
      deprecatedIntroduced: [],
    },
    artifacts: [
      {
        package: "canary-pkg",
        version: "1.0.0",
        integrity: "sha512-canary",
        verdict: "allow",
        summary: "no findings",
        categories: [],
      },
    ],
    unresolved: [],
    conflicts: [],
    truncated: false,
    resolver: "metadata",
    coverage: { analyzed: 1, changed: 1, ratio: 1 },
    decision: "needs_approval",
    reasons: [],
    next_actions: [],
    ...over,
  };
}

const realDeps = () => ({
  exec: (cmd: string[], cwd: string) => ({
    code: Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" }).exitCode ?? 1,
  }),
  readFile: (path: string) => readFileSync(path, "utf8"),
  writeFile: (path: string, data: string) => writeFileSync(path, data),
  exists: (path: string) => existsSync(path),
  scriptBody: () => Promise.resolve("node install.js"),
  approvals: [],
  analyzerVersion: "canary",
});

test.skipIf(!npm)(
  "the canary dependency really does execute when nothing suppresses it",
  () => {
    rmSync(canaryPath(), { force: true });
    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    const result = Bun.spawnSync(["npm", "install", "--no-audit", "--no-fund"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(canaryPath())).toBe(true);
  },
  120_000,
);

test.skipIf(!npm)(
  "a warden apply installs the same dependency without its scripts ever running",
  async () => {
    rmSync(canaryPath(), { force: true });
    rmSync(join(root, "node_modules"), { recursive: true, force: true });

    const receipt = await applyTransaction(plan(), realDeps(), {
      verify: false,
      allowUnapproved: true,
    });

    expect(receipt.result).toBe("applied");
    expect(existsSync(join(root, "node_modules", "canary-pkg", "package.json"))).toBe(true);
    expect(existsSync(canaryPath())).toBe(false);
  },
  120_000,
);

test.skipIf(!npm)(
  "an approved script is still not executed by the install itself",
  async () => {
    rmSync(canaryPath(), { force: true });
    rmSync(join(root, "node_modules"), { recursive: true, force: true });

    const receipt = await applyTransaction(
      plan(),
      {
        ...realDeps(),
        approvals: (["preinstall", "postinstall"] as const).map((hook) => ({
          schema_version: 1 as const,
          package: "canary-pkg",
          version: "1.0.0",
          integrity: "sha512-canary",
          hook,
          script_hash: hashScript("node install.js"),
          scope: "repo" as const,
          approved_at: "2026-01-01T00:00:00.000Z",
        })),
      },
      { verify: false },
    );

    expect(receipt.result).toBe("applied");
    expect(receipt.approvals).toHaveLength(2);
    expect(existsSync(canaryPath())).toBe(false);
  },
  120_000,
);

test.skipIf(!npm)(
  "a refused transaction runs no package manager command at all",
  async () => {
    rmSync(canaryPath(), { force: true });
    rmSync(join(root, "node_modules"), { recursive: true, force: true });

    const receipt = await applyTransaction(plan(), realDeps(), { verify: false });

    expect(receipt.result).toBe("refused");
    expect(existsSync(canaryPath())).toBe(false);
    expect(existsSync(join(root, "node_modules", "canary-pkg"))).toBe(false);
  },
  120_000,
);

test("the suppression flag the canary relies on is the one warden actually passes", () => {
  expect(installCommand("npm", [], true)).toEqual(["npm", "install", "--ignore-scripts"]);
  expect(installCommand("npm", ["x"], true)).toContain("--ignore-scripts");
  expect(installCommand("pnpm", ["x"], true)).toContain("--ignore-scripts");
});
