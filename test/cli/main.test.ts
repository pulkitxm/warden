/** CLI cores (runWnpm / runWnpx) with injected deps — no real package-manager
 * execution, no live registry. The mini-registry + env are a safety net so any
 * accidentally-unstubbed check still can't reach the network. */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { startMiniRegistry, type MiniRegistry } from "../../fixtures/registry/server.ts";
import { runWnpm, runWnpx, defaultDeps, type RunDeps } from "../../src/cli/main.ts";
import { SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry(0, { only: true, fixtures: [] });
  process.env.WARDEN_REGISTRY = reg.url;
  process.env.WARDEN_DOWNLOADS = reg.downloadsUrl;
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => reg.stop());

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

/** Deps harness: collects stdout/stderr; everything else must be stubbed per test. */
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

// ---- wnpx ------------------------------------------------------------------

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
  expect(err).toEqual([]); // stdout purity: nothing else anywhere
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
  const { deps } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "warn", risk_score: 40 })) });
  expect(await runWnpx(["shady"], deps)).toBe(10);
});

test("wnpx human block refuses and exits 20", async () => {
  const { deps, err } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "block", risk_score: 95 })) });
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

// ---- wnpm ------------------------------------------------------------------

test("wnpm rejects unknown verbs with exit 2", async () => {
  const { deps, err } = makeDeps();
  expect(await runWnpm(["remove", "left-pad"], deps)).toBe(2);
  expect(err.join("")).toContain('unknown command "remove"');
});

test("wnpm with nothing to install exits 2 (missing or empty package.json)", async () => {
  const missing = makeDeps(); // readFile throws -> directDeps catch
  expect(await runWnpm(["install"], missing.deps)).toBe(2);
  expect(missing.err.join("")).toContain("nothing to install");

  const empty = makeDeps({ readFile: () => "{}" });
  expect(await runWnpm([], empty.deps)).toBe(2); // no verb at all
});

test("wnpm falls back to package.json direct deps and installs via pnpm", async () => {
  const { deps, err, spawns } = makeDeps({
    readFile: () => JSON.stringify({ dependencies: { "left-pad": "^1.3.0" }, devDependencies: { chalk: "^5" } }),
    which: (p) => (p === "pnpm" ? "/usr/bin/pnpm" : null),
  });
  expect(await runWnpm(["install"], deps)).toBe(0);
  expect(err.join("")).toContain("vetting 2 package(s)");
  expect(err.join("")).toContain("installing via pnpm");
  // No explicit targets -> plain install of the lockfile, scripts disabled.
  expect(spawns).toEqual([["pnpm", "install", "--ignore-scripts"]]);
});

test("wnpm via bun omits --ignore-scripts (bun disables scripts by default)", async () => {
  const { deps, spawns } = makeDeps({ which: (p) => (p === "bun" ? "/usr/bin/bun" : null) });
  expect(await runWnpm(["add", "left-pad"], deps)).toBe(0);
  expect(spawns).toEqual([["bun", "install", "left-pad"]]);
});

test("wnpm falls back to npm when no manager is on PATH, propagating its exit code", async () => {
  const calls: string[][] = [];
  const { deps } = makeDeps({ spawn: (cmd) => (calls.push(cmd), 7) });
  expect(await runWnpm(["i", "left-pad"], deps)).toBe(7);
  expect(calls).toEqual([["npm", "install", "--ignore-scripts", "left-pad"]]);
});

test("wnpm --json emits the verdict array on stdout, in input order (bounded pool)", async () => {
  const targets = Array.from({ length: 10 }, (_, i) => `pkg-${i}`); // > pool limit of 8
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
  expect(await runWnpm(["install", "a", "b", "c"], deps)).toBe(20); // b blocks
  const text = err.join("");
  expect(text.indexOf("BLOCK")).toBeLessThan(text.indexOf("WARN"));
  expect(text.indexOf("WARN")).toBeLessThan(text.indexOf("ALLOW"));
  expect(text).toContain("install blocked: 1 package(s)");
});

test("wnpm --json block skips the human report but still exits 20", async () => {
  const { deps, out, err } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "block", summary: "bad news" })) });
  expect(await runWnpm(["install", "evil", "--json"], deps)).toBe(20);
  expect((JSON.parse(out[0]!) as Verdict[])[0]!.verdict).toBe("block");
  expect(err.join("")).not.toContain("bad news"); // no renderVerdict in json mode
  expect(err.join("")).toContain("install blocked");
});

test("wnpm --allow-risky overrides a block and installs anyway", async () => {
  const { deps, spawns } = makeDeps({ check: () => Promise.resolve(verdict({ verdict: "block" })) });
  expect(await runWnpm(["install", "evil", "--allow-risky"], deps)).toBe(0);
  expect(spawns).toHaveLength(1);
});

test("wnpm analysis error exits 30", async () => {
  const { deps, err } = makeDeps({ check: () => Promise.reject(new Error("boom")) });
  expect(await runWnpm(["install", "left-pad"], deps)).toBe(30);
  expect(err.join("")).toContain("wnpm: analysis error: boom");
});

// ---- default deps (the shims' real effects) ---------------------------------

test("defaultDeps: spawn returns the command's exit code, readFile reads files", () => {
  expect(defaultDeps.spawn(["sh", "-c", "exit 7"])).toBe(7);
  expect(defaultDeps.readFile(fileURLToPath(new URL("../../package.json", import.meta.url)))).toContain('"name": "wnpm"');
  expect(typeof defaultDeps.which("sh")).toBe("string");
});
