import { expect, test } from "bun:test";
import { ANALYZER_VERSION, type CiFinding, SCHEMA_VERSION } from "../../src/schema.ts";
import { SARIF_SCHEMA_URL, toSarif } from "../../src/shared/sarif.ts";

const finding = (over: Partial<CiFinding> = {}): CiFinding => ({
  schema_version: SCHEMA_VERSION,
  rule: "lockfile_lookalike_registry",
  package: "a@1.0.0",
  file: "package-lock.json",
  line: 7,
  level: "block",
  evidence: "resolved from registry.npmjs.help",
  fix: "repoint this entry",
  verify: "warden ci --reporter agent",
  seen_before: false,
  ...over,
});

const run = (findings: CiFinding[]) =>
  // biome-ignore lint/suspicious/noExplicitAny: SARIF is validated structurally in this test
  toSarif(findings, "https://warden.pulkit.page/docs/ci") as any;

test("an empty run is still a valid SARIF document", () => {
  const sarif = run([]);
  expect(sarif.$schema).toBe(SARIF_SCHEMA_URL);
  expect(sarif.version).toBe("2.1.0");
  expect(sarif.runs).toHaveLength(1);
  expect(sarif.runs[0].results).toEqual([]);
  expect(sarif.runs[0].tool.driver.name).toBe("Warden");
  expect(sarif.runs[0].tool.driver.version).toBe(ANALYZER_VERSION);
});

test("verdict levels map onto SARIF levels", () => {
  const sarif = run([
    finding({ level: "block", rule: "a" }),
    finding({ level: "warn", rule: "b" }),
    finding({ level: "allow", rule: "c" }),
  ]);
  expect(sarif.runs[0].results.map((r: { level: string }) => r.level)).toEqual([
    "error",
    "warning",
    "note",
  ]);
});

test("each finding carries a file location and line", () => {
  const location = run([finding()]).runs[0].results[0].locations[0].physicalLocation;
  expect(location.artifactLocation.uri).toBe("package-lock.json");
  expect(location.region.startLine).toBe(7);
});

test("a finding without a line omits the region rather than emitting zero", () => {
  const location = run([finding({ line: undefined })]).runs[0].results[0].locations[0]
    .physicalLocation;
  expect(location.region).toBeUndefined();
});

test("the message carries evidence, fix, and verify so the fix is actionable", () => {
  const text = run([finding()]).runs[0].results[0].message.text;
  expect(text).toContain("a@1.0.0");
  expect(text).toContain("registry.npmjs.help");
  expect(text).toContain("repoint this entry");
  expect(text).toContain("warden ci --reporter agent");
});

test("rules are deduplicated across findings", () => {
  const sarif = run([finding(), finding({ package: "b@2.0.0" }), finding({ rule: "other" })]);
  expect(sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual([
    "lockfile_lookalike_registry",
    "other",
  ]);
  expect(sarif.runs[0].results).toHaveLength(3);
});

test("rule ids are readable in the code scanning UI", () => {
  const rule = run([finding()]).runs[0].tool.driver.rules[0];
  expect(rule.id).toBe("lockfile_lookalike_registry");
  expect(rule.shortDescription.text).toBe("lockfile lookalike registry");
});
