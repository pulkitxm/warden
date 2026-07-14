import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change } from "../../src/doctor/plan.ts";
import type { Project } from "../../src/doctor/project.ts";
import {
  applyChanges,
  applyPlan,
  defaultVerifyDeps,
  type VerifyDeps,
  verifyPlan,
} from "../../src/doctor/verify.ts";

const change = (over: Partial<Change> = {}): Change => ({
  name: "lib",
  from: "1.0.0",
  to: "1.2.0",
  inRange: true,
  level: "minor",
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  dir: "/proj",
  name: "demo",
  scripts: { test: "run tests", build: "run build" },
  deps: [],
  packageManager: "npm",
  ...over,
});

interface Fake {
  deps: VerifyDeps;
  calls: Array<{ cmd: string[]; cwd: string }>;
  written: Record<string, string>;
}

function fakeDeps(pkgJson: string, codes: number[] = [], which: string | null = null): Fake {
  const calls: Array<{ cmd: string[]; cwd: string }> = [];
  const written: Record<string, string> = {};
  let tick = 0;
  const deps: VerifyDeps = {
    exec: (cmd, cwd) => {
      calls.push({ cmd, cwd });
      return { code: codes[calls.length - 1] ?? 0 };
    },
    mkWorkspace: () => "/workspace",
    readFile: () => pkgJson,
    writeFile: (path, content) => {
      written[path] = content;
    },
    which: () => which,
    now: () => tick++,
  };
  return { deps, calls, written };
}

test("applyChanges pins changed dependencies to the exact verified version", () => {
  const input = JSON.stringify({
    dependencies: { caret: "^1.0.0", exact: "1.0.0" },
    devDependencies: { tilde: "~1.0.0" },
  });
  const output = applyChanges(input, [
    change({ name: "caret", to: "1.5.0" }),
    change({ name: "exact", to: "2.0.0" }),
    change({ name: "tilde", to: "1.0.9" }),
    change({ name: "absent", to: "9.9.9" }),
  ]);
  const pkg = JSON.parse(output) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  expect(pkg.dependencies.caret).toBe("1.5.0");
  expect(pkg.dependencies.exact).toBe("2.0.0");
  expect(pkg.devDependencies.tilde).toBe("1.0.9");
  expect(output.endsWith("\n")).toBe(true);
  expect(applyChanges("{}", [change()])).toBe("{}\n");
});

test("verifyPlan copies, patches, installs, and runs present scripts in order", async () => {
  const { deps, calls, written } = fakeDeps(JSON.stringify({ dependencies: { lib: "^1.0.0" } }));
  const result = await verifyPlan(project(), [change()], deps);
  expect(result.workspace).toBe("/workspace");
  expect(result.passed).toBe(true);
  expect(written[join("/workspace", "package.json")]).toContain('"lib": "1.2.0"');
  expect(calls.map((c) => c.cmd[0])).toEqual(["npm", "npm", "npm"]);
  expect(calls.map((c) => c.cwd)).toEqual(["/workspace", "/workspace", "/workspace"]);
  expect(result.steps.map((s) => s.name)).toEqual(["install", "test", "build"]);
  expect(result.steps.every((s) => s.ok && s.ms >= 0)).toBe(true);
});

test("verifyPlan stops after a failing install", async () => {
  const { deps } = fakeDeps("{}", [1]);
  const result = await verifyPlan(project(), [], deps);
  expect(result.passed).toBe(false);
  expect(result.steps).toEqual([{ name: "install", ok: false, ms: 1 }]);
});

test("verifyPlan stops after the first failing script", async () => {
  const { deps, calls } = fakeDeps("{}", [0, 1]);
  const result = await verifyPlan(project(), [], deps);
  expect(result.passed).toBe(false);
  expect(result.steps.map((s) => [s.name, s.ok])).toEqual([
    ["install", true],
    ["test", false],
  ]);
  expect(calls).toHaveLength(2);
});

test("verifyPlan uses bun when the project and PATH support it", async () => {
  const { deps, calls } = fakeDeps("{}", [], "/bin/bun");
  const result = await verifyPlan(project({ packageManager: "bun", scripts: {} }), [], deps);
  expect(result.passed).toBe(true);
  expect(calls[0]?.cmd).toEqual(["bun", "install", "--ignore-scripts"]);
});

test("verifyPlan falls back to npm when bun is requested but missing", async () => {
  const { deps, calls } = fakeDeps("{}", [], null);
  await verifyPlan(project({ packageManager: "bun", scripts: {} }), [], deps);
  expect(calls[0]?.cmd).toEqual(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]);
});

test("applyPlan patches the real package.json and runs a single install", async () => {
  const { deps, calls, written } = fakeDeps(JSON.stringify({ dependencies: { lib: "^1.0.0" } }));
  const result = await applyPlan(project(), [change()], deps);
  expect(result.applied).toBe(true);
  expect(written[join("/proj", "package.json")]).toContain('"lib": "1.2.0"');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.cwd).toBe("/proj");
  expect(result.steps[0]).toMatchObject({ name: "install", ok: true });
});

test("applyPlan reports failure when the install fails", async () => {
  const { deps } = fakeDeps("{}", [1]);
  expect((await applyPlan(project(), [], deps)).applied).toBe(false);
});

test("defaultVerifyDeps talks to the real system", async () => {
  expect((await defaultVerifyDeps.exec(["sh", "-c", "exit 0"], tmpdir())).code).toBe(0);
  expect((await defaultVerifyDeps.exec(["sh", "-c", "exit 3"], tmpdir())).code).toBe(3);
  expect(typeof defaultVerifyDeps.which("sh")).toBe("string");
  expect(defaultVerifyDeps.now()).toBeGreaterThan(0);

  const src = mkdtempSync(join(tmpdir(), "wnpm-verify-src-"));
  writeFileSync(join(src, "package.json"), '{"name":"copy-me"}');
  writeFileSync(join(src, "keep.txt"), "keep");
  mkdirSync(join(src, "node_modules", "junk"), { recursive: true });
  mkdirSync(join(src, ".git"), { recursive: true });
  writeFileSync(join(src, "node_modules", "junk", "index.js"), "skip");

  const dst = defaultVerifyDeps.mkWorkspace(src);
  expect(defaultVerifyDeps.readFile(join(dst, "package.json"))).toContain("copy-me");
  expect(readFileSync(join(dst, "keep.txt"), "utf8")).toBe("keep");
  expect(existsSync(join(dst, "node_modules"))).toBe(false);
  expect(existsSync(join(dst, ".git"))).toBe(false);

  defaultVerifyDeps.writeFile(join(dst, "written.txt"), "hello");
  expect(readFileSync(join(dst, "written.txt"), "utf8")).toBe("hello");
});
