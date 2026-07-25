import { expect, test } from "bun:test";
import { renderBenchmark } from "../../src/cli/commands/benchmark.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

function makeDeps() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    check: () => Promise.reject(new Error("the benchmark supplies its own verdicts")),
  };
  return { deps, out, err };
}

test("the benchmark exits 0 while every case matches its recorded decision", async () => {
  const { deps } = makeDeps();
  expect(await runWarden(["benchmark", "--json"], deps)).toBe(0);
});

test("--json publishes the rates, the cases, and the method behind them", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["benchmark", "--json"], deps);
  const report = JSON.parse(out.join(""));
  expect(report.schema_version).toBe(1);
  expect(report.detection.rate).toBe(1);
  expect(report.falsePositives.rate).toBe(0);
  expect(report.results.length).toBe(report.totals.cases);
  expect(report.method.length).toBeGreaterThan(3);
});

test("the human report leads with detection, false positives, and coverage together", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["benchmark"], deps);
  const text = err.join("");
  expect(text).toContain("detection");
  expect(text).toContain("false positives");
  expect(text).toContain("mean coverage");
  expect(text).toContain("every case matched its expected decision");
});

test("the human report publishes the method rather than only the numbers", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["benchmark"], deps);
  expect(err.join("")).toContain("curated shapes, not a sample of the registry");
});

test("--quiet suppresses the human report", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  expect(await runWarden(["benchmark"], deps)).toBe(0);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("a regressed case is named in the report and turns the exit code red", () => {
  setColor(false);
  const text = renderBenchmark({
    schema_version: 1,
    analyzer_version: "test",
    totals: { cases: 2, malicious: 1, benign: 1 },
    detection: { caught: 0, missed: 1, rate: 0 },
    falsePositives: { count: 0, rate: 0 },
    meanCoverage: 1,
    results: [
      {
        id: "mal-example",
        shape: "a malicious shape that stopped being caught",
        kind: "malicious",
        expected: "block",
        actual: "allow",
        correct: false,
        coverage: 1,
      },
      {
        id: "benign-example",
        shape: "a benign shape that still passes",
        kind: "benign",
        expected: "allow",
        actual: "allow",
        correct: true,
        coverage: 1,
      },
    ],
    method: ["a note"],
  });
  expect(text).toContain("Cases that did not match the expected decision");
  expect(text).toContain("mal-example");
  expect(text).toContain("expected block, got allow");
  expect(text).toContain("0.0%");
  expect(text).not.toContain("every case matched");
});

test("the rates are rendered as percentages a person can read", () => {
  setColor(false);
  const text = renderBenchmark({
    schema_version: 1,
    analyzer_version: "test",
    totals: { cases: 4, malicious: 3, benign: 1 },
    detection: { caught: 2, missed: 1, rate: 2 / 3 },
    falsePositives: { count: 1, rate: 1 },
    meanCoverage: 0.875,
    results: [],
    method: [],
  });
  expect(text).toContain("66.7%");
  expect(text).toContain("100.0%");
  expect(text).toContain("87.5%");
});
