import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDeps,
  defaultWardenDeps,
  type RunDeps,
  runWarden,
  runWnpm,
  runWnpx,
  type WardenDeps,
} from "../../src/cli/main.ts";
import { SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";

const strip = (s: string) =>
  s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  schema_version: SCHEMA_VERSION,
  package: "demo-pkg",
  version: "1.0.0",
  integrity: "sha512-abc",
  verdict: "allow",
  risk_score: 0,
  categories: [],
  summary: "all clear",
  evidence: [],
  analyzer_version: "0.1.0",
  source: "heuristics",
  ...over,
});

function makeDeps(over: Partial<RunDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const spawns: string[][] = [];
  const deps: RunDeps = {
    check: (spec) => Promise.resolve(verdict({ package: spec })),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(strip(s)),
    which: () => null,
    spawn: (cmd) => {
      spawns.push(cmd);
      return 0;
    },
    readFile: () => {
      throw new Error("ENOENT");
    },
    ...over,
  };
  return { deps, out, err, spawns };
}

function makeWardenDeps(over: Partial<WardenDeps> = {}) {
  const base = makeDeps();
  const files = new Map<string, string>();
  const deps: WardenDeps = {
    ...base.deps,
    home: "/home/test",
    mkdir: () => undefined,
    readFile: (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeFile: (path, data) => files.set(path, data),
    exists: (path) => files.has(path),
    cwd: () => "/repo",
    glob: () => [],
    git: () => ({ exitCode: 1, stdout: "", stderr: "git unavailable" }),
    isTTY: () => false,
    prompt: () => Promise.resolve(""),
    ...over,
    selectManagers: over.selectManagers ?? defaultWardenDeps.selectManagers,
  };
  return { ...base, deps, files };
}

test("warden dispatches top-level and per-verb help", async () => {
  const root = makeWardenDeps();
  expect(await runWarden(["--help"], root.deps)).toBe(0);
  expect(root.err.join("")).toContain("usage: warden <verb> [flags]");

  const check = makeWardenDeps();
  expect(await runWarden(["check", "--help"], check.deps)).toBe(0);
  expect(check.err.join("")).toContain("exit codes: 0 allow · 10 warn · 20 block · 30 error");

  const config = makeWardenDeps();
  expect(await runWarden(["config", "--help"], config.deps)).toBe(0);
  expect(config.err.join("")).toContain("usage: warden config");
});

test("warden check emits one object or an ordered array and stable exit codes", async () => {
  const levels: Record<string, Verdict["verdict"]> = {
    clean: "allow",
    uncertain: "warn",
    risky: "block",
  };
  const one = makeWardenDeps({
    check: (spec) => Promise.resolve(verdict({ package: spec, verdict: levels[spec]! })),
  });
  expect(await runWarden(["check", "risky", "--json"], one.deps)).toBe(20);
  expect((JSON.parse(one.out[0]!) as Verdict).package).toBe("risky");

  const many = makeWardenDeps({
    check: (spec) => Promise.resolve(verdict({ package: spec, verdict: levels[spec]! })),
  });
  expect(await runWarden(["check", "clean", "uncertain", "--json"], many.deps)).toBe(10);
  expect((JSON.parse(many.out[0]!) as Verdict[]).map((item) => item.package)).toEqual([
    "clean",
    "uncertain",
  ]);

  const override = makeWardenDeps({
    check: () => Promise.resolve(verdict({ verdict: "block" })),
  });
  expect(await runWarden(["check", "risky", "--allow-risky"], override.deps)).toBe(10);

  const human = makeWardenDeps();
  expect(await runWarden(["check", "one", "two"], human.deps)).toBe(0);
  expect(human.err.join("")).toContain("ALLOW one@1.0.0");
});

test("warden failures use typed JSON error envelopes and exit 30", async () => {
  const unknown = makeWardenDeps();
  expect(await runWarden(["missing", "--json"], unknown.deps)).toBe(30);
  expect(JSON.parse(unknown.out[0]!)).toEqual({
    error: {
      kind: "usage",
      code: "WARDEN_UNKNOWN_VERB",
      reason: 'unknown verb "missing"',
      hint: "run warden --help",
    },
  });

  const failed = makeWardenDeps({ check: () => Promise.reject(new Error("registry down")) });
  expect(await runWarden(["check", "demo", "--json"], failed.deps)).toBe(30);
  expect(JSON.parse(failed.out[0]!).error.kind).toBe("analysis");

  const missing = makeWardenDeps();
  expect(await runWarden(["check", "--json"], missing.deps)).toBe(30);
  expect(JSON.parse(missing.out[0]!).error.code).toBe("WARDEN_MISSING_PACKAGE");
});

test("warden config reads and writes through injected dependencies", async () => {
  const state = makeWardenDeps();
  expect(await runWarden(["config", "--json"], state.deps)).toBe(0);
  expect(JSON.parse(state.out[0]!)).toEqual({
    mode: "brief",
    intercept: { install: true, exec: true },
  });

  expect(await runWarden(["config", "intercept", "off"], state.deps)).toBe(0);
  expect(JSON.parse(state.files.get("/home/test/.warden/config.json")!)).toEqual({
    mode: "brief",
    intercept: { install: false, exec: false },
  });

  expect(await runWarden(["config", "intercept", "install", "on"], state.deps)).toBe(0);
  expect(await runWarden(["config", "mode", "log"], state.deps)).toBe(0);
  expect(JSON.parse(state.files.get("/home/test/.warden/config.json")!)).toEqual({
    mode: "log",
    intercept: { install: true, exec: false },
  });

  const human = makeWardenDeps();
  expect(await runWarden(["config"], human.deps)).toBe(0);
  expect(human.err.join("")).toContain('"mode": "brief"');
});

test("warden config rejects invalid files and settings", async () => {
  const invalidFile = makeWardenDeps({ readFile: () => "{}" });
  expect(await runWarden(["config", "--json"], invalidFile.deps)).toBe(30);
  expect(JSON.parse(invalidFile.out[0]!).error.reason).toBe("invalid user config");

  for (const args of [["mode", "nope"], ["intercept", "maybe"], ["unknown"]]) {
    const state = makeWardenDeps();
    expect(await runWarden(["config", ...args, "--json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error.kind).toBe("config");
  }
});

test("default warden dependencies cover filesystem, workspace, git, TTY, and prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "warden-config-"));
  const nested = join(root, "nested");
  defaultWardenDeps.mkdir(nested);
  expect(existsSync(nested)).toBe(true);
  defaultWardenDeps.writeFile(join(nested, "package.json"), "{}\n");
  expect(defaultWardenDeps.exists(join(nested, "package.json"))).toBe(true);
  expect(defaultWardenDeps.glob("package.json", nested)).toEqual(["package.json"]);
  expect(defaultWardenDeps.cwd()).toBe(process.cwd());
  expect(
    defaultWardenDeps.git(["rev-parse", "--is-inside-work-tree"], process.cwd()).exitCode,
  ).toBe(0);
  expect(typeof defaultWardenDeps.isTTY()).toBe("boolean");
  const saved = globalThis.prompt;
  globalThis.prompt = () => "yes";
  expect(await defaultWardenDeps.prompt("continue? ")).toBe("yes");
  globalThis.prompt = saved;
  rmSync(root, { recursive: true });
});

test("wnpx --schema prints the JSON schema on stdout and exits 0", async () => {
  const { deps, out, err } = makeDeps();
  expect(await runWnpx(["--schema"], deps)).toBe(0);
  expect(err).toEqual([]);
  const schema = JSON.parse(out.join("")) as { required: string[] };
  expect(schema.required).toContain("verdict");
});

test("wnpx with no spec prints usage and exits 2", async () => {
  const { deps, out, err } = makeDeps();
  expect(await runWnpx([], deps)).toBe(2);
  expect(out).toEqual([]);
  expect(err.join("")).toContain("usage: wnpx");
});

test("wnpx --json emits EXACTLY one JSON object on stdout (allow -> 0)", async () => {
  const { deps, out, err } = makeDeps();
  expect(await runWnpx(["left-pad", "--json"], deps)).toBe(0);
  expect(out).toHaveLength(1);
  expect((JSON.parse(out[0]!) as Verdict).package).toBe("left-pad");
  expect(err).toEqual([]);
});

test("wnpx --json block exits 20", async () => {
  const { deps, out } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "block" })) });
  expect(await runWnpx(["evil", "--json"], deps)).toBe(20);
  expect((JSON.parse(out[0]!) as Verdict).verdict).toBe("block");
});

test("wnpx human allow renders the report and exits 0", async () => {
  const { deps, out, err } = makeDeps();
  expect(await runWnpx(["left-pad"], deps)).toBe(0);
  expect(out).toEqual([]);
  expect(err.join("")).toContain("ALLOW");
  expect(err.join("")).toContain("(would execute: npx left-pad)");
});

test("wnpx human warn exits 10", async () => {
  const { deps } = makeDeps({
    check: () => Promise.resolve(verdict({ verdict: "warn", risk_score: 40 })),
  });
  expect(await runWnpx(["shady"], deps)).toBe(10);
});

test("wnpx human block refuses and exits 20", async () => {
  const { deps, err } = makeDeps({
    check: () => Promise.resolve(verdict({ verdict: "block", risk_score: 95 })),
  });
  expect(await runWnpx(["evil"], deps)).toBe(20);
  expect(err.join("")).toContain("refusing to run a blocked package");
});

test("wnpx block with --allow-risky proceeds but exits as warn (10)", async () => {
  const { deps, err } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "block" })) });
  expect(await runWnpx(["evil", "--allow-risky"], deps)).toBe(10);
  expect(err.join("")).toContain("(would execute: npx evil)");
});

test("wnpx analysis error exits 30", async () => {
  const { deps, err } = makeDeps({ check: () => Promise.reject(new Error("registry down")) });
  expect(await runWnpx(["left-pad"], deps)).toBe(30);
  expect(err.join("")).toContain("wnpx: analysis error: registry down");
});

test("wnpm rejects unknown verbs with exit 2", async () => {
  const { deps, err } = makeDeps();
  expect(await runWnpm(["remove", "left-pad"], deps)).toBe(2);
  expect(err.join("")).toContain('unknown command "remove"');
});

test("wnpm with nothing to install exits 2 (missing or empty package.json)", async () => {
  const missing = makeDeps();
  expect(await runWnpm(["install"], missing.deps)).toBe(2);
  expect(missing.err.join("")).toContain("nothing to install");

  const empty = makeDeps({ readFile: () => "{}" });
  expect(await runWnpm([], empty.deps)).toBe(2);
});

test("wnpm falls back to package.json direct deps and installs via pnpm", async () => {
  const { deps, err, spawns } = makeDeps({
    readFile: () =>
      JSON.stringify({ dependencies: { "left-pad": "^1.3.0" }, devDependencies: { chalk: "^5" } }),
    which: (p) => (p === "pnpm" ? "/usr/bin/pnpm" : null),
  });
  expect(await runWnpm(["install"], deps)).toBe(0);
  expect(err.join("")).toContain("vetting 2 package(s)");
  expect(err.join("")).toContain("installing via pnpm");
  expect(spawns).toEqual([["pnpm", "install", "--ignore-scripts"]]);
});

test("wnpm via bun omits --ignore-scripts (bun disables scripts by default)", async () => {
  const { deps, spawns } = makeDeps({ which: (p) => (p === "bun" ? "/usr/bin/bun" : null) });
  expect(await runWnpm(["add", "left-pad"], deps)).toBe(0);
  expect(spawns).toEqual([["bun", "install", "left-pad"]]);
});

test("wnpm falls back to npm when no manager is on PATH, propagating its exit code", async () => {
  const calls: string[][] = [];
  const { deps } = makeDeps({
    spawn: (cmd) => {
      calls.push(cmd);
      return 7;
    },
  });
  expect(await runWnpm(["i", "left-pad"], deps)).toBe(7);
  expect(calls).toEqual([["npm", "install", "--ignore-scripts", "left-pad"]]);
});

test("wnpm --json emits the verdict array on stdout, in input order (bounded pool)", async () => {
  const targets = Array.from({ length: 10 }, (_, i) => `pkg-${i}`);
  const { deps, out } = makeDeps();
  expect(await runWnpm(["install", ...targets, "--json"], deps)).toBe(0);
  expect(out).toHaveLength(1);
  const verdicts = JSON.parse(out[0]!) as Verdict[];
  expect(verdicts.map((v) => v.package)).toEqual(targets);
});

test("wnpm groups the human report block > warn > allow", async () => {
  const levels: Record<string, Verdict["verdict"]> = { a: "allow", b: "block", c: "warn" };
  const { deps, err } = makeDeps({
    check: (spec) => Promise.resolve(verdict({ package: spec, verdict: levels[spec]! })),
  });
  expect(await runWnpm(["install", "a", "b", "c"], deps)).toBe(20);
  const text = err.join("");
  expect(text.indexOf("BLOCK")).toBeLessThan(text.indexOf("WARN"));
  expect(text.indexOf("WARN")).toBeLessThan(text.indexOf("ALLOW"));
  expect(text).toContain("install blocked: 1 package(s)");
});

test("wnpm --json block skips the human report but still exits 20", async () => {
  const { deps, out, err } = makeDeps({
    check: () => Promise.resolve(verdict({ verdict: "block", summary: "bad news" })),
  });
  expect(await runWnpm(["install", "evil", "--json"], deps)).toBe(20);
  expect((JSON.parse(out[0]!) as Verdict[])[0]!.verdict).toBe("block");
  expect(err.join("")).not.toContain("bad news");
  expect(err.join("")).toContain("install blocked");
});

test("wnpm --allow-risky overrides a block and installs anyway", async () => {
  const { deps, spawns } = makeDeps({
    check: () => Promise.resolve(verdict({ verdict: "block" })),
  });
  expect(await runWnpm(["install", "evil", "--allow-risky"], deps)).toBe(0);
  expect(spawns).toHaveLength(1);
});

test("wnpm analysis error exits 30", async () => {
  const { deps, err } = makeDeps({ check: () => Promise.reject(new Error("boom")) });
  expect(await runWnpm(["install", "left-pad"], deps)).toBe(30);
  expect(err.join("")).toContain("wnpm: analysis error: boom");
});

test("wnpx unknown flags print usage and exit 2 instead of crashing", async () => {
  const { deps, err } = makeDeps();
  expect(await runWnpx(["left-pad", "--bogus"], deps)).toBe(2);
  expect(err.join("")).toContain("usage: wnpx");
});

test("defaultDeps: spawn returns the command's exit code, readFile reads files", () => {
  expect(defaultDeps.spawn(["sh", "-c", "exit 7"])).toBe(7);
  expect(
    defaultDeps.readFile(fileURLToPath(new URL("../../package.json", import.meta.url))),
  ).toContain('"name": "wnpm"');
  expect(typeof defaultDeps.which("sh")).toBe("string");
});
