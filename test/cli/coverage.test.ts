import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { COMMAND_REGISTRY } from "../../src/cli/registry.ts";
import { setVerbosity } from "../../src/shared/output.ts";
import { COVERAGE_MATRIX, planCommand, UNSUPPORTED_PATHS } from "../../src/shim/grammar.ts";

function makeDeps() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { deps, out, err };
}

test("coverage is a public verb", () => {
  const command = COMMAND_REGISTRY.find((entry) => entry.name === "coverage");
  expect(command).toBeDefined();
  expect(command?.hidden).toBeUndefined();
});

test("shim-plan is hidden, because it exists for the shim rather than for people", () => {
  const command = COMMAND_REGISTRY.find((entry) => entry.name === "shim-plan");
  expect(command?.hidden).toBe(true);
});

test("warden coverage --json publishes the matrix and the unsupported paths", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["coverage", "--json"], deps)).toBe(0);
  const payload = JSON.parse(out.join(""));
  expect(payload.matrix.length).toBe(COVERAGE_MATRIX.length);
  expect(payload.unsupported.length).toBe(UNSUPPORTED_PATHS.length);
  expect(payload.matrix.some((row: { command: string }) => row.command === "ci")).toBe(true);
});

test("warden coverage renders every manager and states the shim boundary", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["coverage"], deps)).toBe(0);
  const text = err.join("");
  for (const manager of ["npm", "pnpm", "yarn", "bun", "npx", "bunx"]) {
    expect(text).toContain(manager);
  }
  expect(text).toContain("npm ci");
  expect(text).toContain("Not mediated by the shim");
  expect(text).toContain("not an operating-system sandbox");
});

test("coverage honours --quiet", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  expect(await runWarden(["coverage"], deps)).toBe(0);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("shim-plan emits a plan the shim can parse", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["shim-plan", "npm", "ci"], deps)).toBe(0);
  const plan = JSON.parse(out.join(""));
  expect(plan).toEqual(planCommand("npm", ["ci"]));
  expect(plan.kind).toBe("frozen-install");
});

test("shim-plan on an unknown tool degrades to passthrough rather than failing", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["shim-plan", "make", "install"], deps)).toBe(0);
  expect(JSON.parse(out.join("")).kind).toBe("passthrough");
});

test("shim-plan with no tool at all is still safe", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["shim-plan"], deps)).toBe(0);
  expect(JSON.parse(out.join("")).kind).toBe("passthrough");
});

test("every mediated manager command round-trips through shim-plan", async () => {
  for (const row of COVERAGE_MATRIX) {
    if (row.command.startsWith("<")) continue;
    const { deps, out } = makeDeps();
    await runWarden(["shim-plan", row.manager, ...row.command.split(" ")], deps);
    expect(JSON.parse(out.join("")).kind).toBe(row.kind);
  }
});
