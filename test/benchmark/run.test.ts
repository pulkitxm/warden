import { expect, test } from "bun:test";
import { BENCHMARK_CASES } from "../../src/benchmark/cases.ts";
import { type BenchmarkCase, runBenchmark, runCase } from "../../src/benchmark/run.ts";

const report = await runBenchmark(BENCHMARK_CASES, "test");

test("every published case matches the decision it claims", () => {
  for (const result of report.results) {
    expect(`${result.id}: ${result.actual}`).toBe(`${result.id}: ${result.expected}`);
  }
});

test("every malicious shape in the corpus is stopped", () => {
  expect(report.detection.missed).toBe(0);
  expect(report.detection.rate).toBe(1);
});

test("no benign shape in the corpus is stopped", () => {
  expect(report.falsePositives.count).toBe(0);
  expect(report.falsePositives.rate).toBe(0);
});

test("the corpus contains both kinds and enough of each to mean something", () => {
  expect(report.totals.malicious).toBeGreaterThanOrEqual(10);
  expect(report.totals.benign).toBeGreaterThanOrEqual(6);
  expect(report.totals.cases).toBe(report.totals.malicious + report.totals.benign);
});

test("coverage is reported and is not silently partial", () => {
  expect(report.meanCoverage).toBe(1);
});

test("every case id is unique, so a result can be traced back", () => {
  const ids = BENCHMARK_CASES.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every case documents the shape it stands for", () => {
  for (const entry of BENCHMARK_CASES) expect(entry.shape.length).toBeGreaterThan(20);
});

test("a malicious case never expects a plain allow", () => {
  for (const entry of BENCHMARK_CASES.filter((row) => row.kind === "malicious")) {
    expect(`${entry.id}: ${entry.expected}`).not.toBe(`${entry.id}: allow`);
  }
});

test("a benign case always expects a plain allow", () => {
  for (const entry of BENCHMARK_CASES.filter((row) => row.kind === "benign")) {
    expect(`${entry.id}: ${entry.expected}`).toBe(`${entry.id}: allow`);
  }
});

test("no benign case smuggles in a bad verdict or a new install script", () => {
  for (const entry of BENCHMARK_CASES.filter((row) => row.kind === "benign")) {
    expect(entry.verdicts ?? {}).toEqual({});
  }
});

test("the method is published alongside the numbers", () => {
  expect(report.method.length).toBeGreaterThanOrEqual(4);
  expect(report.method.join(" ")).toContain("curated shapes, not a sample of the registry");
  expect(report.method.join(" ")).toContain("real resolver");
});

test("a regressed case is reported rather than quietly averaged away", async () => {
  const broken: BenchmarkCase = {
    id: "synthetic-regression",
    shape: "a malicious shape whose expectation no longer holds, used to prove the harness fails",
    kind: "malicious",
    packages: { clean: { version: "1.0.0" } },
    root: { name: "clean", range: "latest" },
    expected: "block",
  };
  const result = await runCase(broken);
  expect(result.correct).toBe(false);
  expect(result.actual).toBe("allow");

  const withRegression = await runBenchmark([broken], "test");
  expect(withRegression.detection.rate).toBe(0);
  expect(withRegression.detection.missed).toBe(1);
});

test("a benign shape that started blocking shows up as a false positive", async () => {
  const regressed: BenchmarkCase = {
    id: "synthetic-false-positive",
    shape: "a benign shape that now blocks, used to prove false positives are counted",
    kind: "benign",
    packages: { thing: { version: "1.0.0" } },
    verdicts: { thing: "block" },
    root: { name: "thing", range: "latest" },
    expected: "allow",
  };
  const result = await runBenchmark([regressed], "test");
  expect(result.falsePositives.count).toBe(1);
  expect(result.falsePositives.rate).toBe(1);
});

test("an empty corpus does not divide by zero", async () => {
  const empty = await runBenchmark([], "test");
  expect(empty.detection.rate).toBe(1);
  expect(empty.falsePositives.rate).toBe(0);
  expect(empty.meanCoverage).toBe(1);
});

test("a warn-only case counts as neither caught nor a false positive stop", async () => {
  const warned: BenchmarkCase = {
    id: "synthetic-warn",
    shape: "a shape that warns without stopping, used to check the stop definition",
    kind: "malicious",
    packages: { thing: { version: "1.0.0" } },
    verdicts: { thing: "warn" },
    root: { name: "thing", range: "latest" },
    expected: "warn",
  };
  const result = await runBenchmark([warned], "test");
  expect(result.detection.caught).toBe(0);
  expect(result.results[0]?.correct).toBe(true);
});
