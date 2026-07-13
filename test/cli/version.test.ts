import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { ANALYZER_VERSION } from "../../src/schema.ts";

function makeDeps() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { deps, out, err };
}

test("warden --version prints the analyzer version to stdout and exits 0", async () => {
  const state = makeDeps();
  expect(await runWarden(["--version"], state.deps)).toBe(0);
  expect(state.out.join("")).toBe(`${ANALYZER_VERSION}\n`);
  expect(state.err).toEqual([]);
});

test("warden -v and warden version behave identically", async () => {
  for (const argv of [["-v"], ["version"]]) {
    const state = makeDeps();
    expect(await runWarden(argv, state.deps)).toBe(0);
    expect(state.out.join("")).toBe(`${ANALYZER_VERSION}\n`);
  }
});

test("warden version --help renders command help instead of the version", async () => {
  const state = makeDeps();
  expect(await runWarden(["version", "--help"], state.deps)).toBe(0);
  expect(state.out).toEqual([]);
  expect(state.err.join("")).toContain("warden version: print the warden version");
});
