import { expect, test } from "bun:test";
import {
  type ApprovalRequirement,
  analysisRequirements,
  analysisRequirementsFor,
  describeRequirement,
  EXCEPTION_FLAG,
  satisfyingAction,
  scriptRequirements,
  scriptRequirementsFor,
} from "../../src/graph/requirements.ts";

const artifact = (over: Partial<{ package: string; version: string; verdict: string }> = {}) => ({
  package: "mystery",
  version: "1.0.0",
  verdict: "unchecked",
  ...over,
});

test("each new hook becomes its own requirement, bound to the artifact", () => {
  const requirements = scriptRequirementsFor(
    [{ name: "esbuild", version: "0.28.1", newHooks: ["preinstall", "postinstall"] }],
    () => "sha512-esbuild",
  );
  expect(requirements).toEqual([
    {
      kind: "script",
      artifact: { name: "esbuild", version: "0.28.1", integrity: "sha512-esbuild" },
      hook: "preinstall",
    },
    {
      kind: "script",
      artifact: { name: "esbuild", version: "0.28.1", integrity: "sha512-esbuild" },
      hook: "postinstall",
    },
  ]);
});

test("an artifact with no known integrity still produces a requirement", () => {
  expect(
    scriptRequirementsFor([{ name: "local", version: "1.0.0", newHooks: ["install"] }])[0],
  ).toEqual({
    kind: "script",
    artifact: { name: "local", version: "1.0.0" },
    hook: "install",
  });
});

test("packages left unanalyzed become one coverage requirement naming them", () => {
  expect(
    analysisRequirementsFor([artifact(), artifact({ package: "other", verdict: "allow" })], false, {
      analyzed: 1,
      changed: 2,
    }),
  ).toEqual([{ kind: "coverage-budget", unchecked: [{ name: "mystery", version: "1.0.0" }] }]);
});

test("a truncated graph is its own requirement, separate from coverage", () => {
  expect(analysisRequirementsFor([], true, { analyzed: 400, changed: 900 })).toEqual([
    { kind: "graph-truncation", analyzed: 400, changed: 900 },
  ]);
});

test("a fully analyzed, untruncated graph requires nothing", () => {
  expect(
    analysisRequirementsFor([artifact({ verdict: "allow" })], false, { analyzed: 1, changed: 1 }),
  ).toEqual([]);
});

test("no script approval can satisfy incomplete analysis or truncation", () => {
  expect(EXCEPTION_FLAG["coverage-budget"]).toBe("--allow-incomplete-analysis");
  expect(EXCEPTION_FLAG["graph-truncation"]).toBe("--allow-incomplete-analysis");
  expect(EXCEPTION_FLAG.script).not.toBe(EXCEPTION_FLAG["coverage-budget"]);
});

test("script and analysis requirements are separable, because they are satisfied differently", () => {
  const requirements: ApprovalRequirement[] = [
    { kind: "script", artifact: { name: "a", version: "1.0.0" }, hook: "postinstall" },
    { kind: "coverage-budget", unchecked: [{ name: "b", version: "2.0.0" }] },
    { kind: "graph-truncation", analyzed: 1, changed: 9 },
  ];
  expect(scriptRequirements(requirements)).toHaveLength(1);
  expect(analysisRequirements(requirements).map((entry) => entry.kind)).toEqual([
    "coverage-budget",
    "graph-truncation",
  ]);
});

test("every requirement says what it is and how to satisfy it", () => {
  const script: ApprovalRequirement = {
    kind: "script",
    artifact: { name: "esbuild", version: "0.28.1" },
    hook: "postinstall",
  };
  expect(describeRequirement(script)).toBe("esbuild@0.28.1 has a postinstall script");
  expect(satisfyingAction(script, "wtxn_1")).toBe(
    "warden approve-script esbuild@0.28.1 --hook postinstall --plan wtxn_1",
  );

  const coverage: ApprovalRequirement = {
    kind: "coverage-budget",
    unchecked: [{ name: "b", version: "2.0.0" }],
  };
  expect(describeRequirement(coverage)).toContain("were not analyzed");
  expect(satisfyingAction(coverage, "wtxn_1")).toBe(
    "warden apply wtxn_1 --allow-incomplete-analysis",
  );

  const truncation: ApprovalRequirement = { kind: "graph-truncation", analyzed: 1, changed: 9 };
  expect(describeRequirement(truncation)).toContain("truncated");
  expect(satisfyingAction(truncation, "wtxn_1")).toBe(
    "warden apply wtxn_1 --allow-incomplete-analysis",
  );
});
