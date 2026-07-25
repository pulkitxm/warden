import { expect, test } from "bun:test";
import {
  CATEGORIES,
  exitCodeFor,
  SCHEMA_VERSION,
  VERDICT_JSON_SCHEMA,
  type Verdict,
} from "../src/schema.ts";

test("Verdict type keys match JSON Schema required keys", () => {
  const sample: Verdict = {
    schema_version: SCHEMA_VERSION,
    package: "x",
    version: "1.0.0",
    integrity: "sha512-abc",
    verdict: "allow",
    risk_score: 0,
    categories: [],
    summary: "",
    evidence: [],
    analyzer_version: "0.1.0",
    source: "heuristics",
  };
  const typeKeys = Object.keys(sample).sort();
  const schemaKeys = [...VERDICT_JSON_SCHEMA.required].sort();
  expect(typeKeys).toEqual(schemaKeys);
  expect(Object.keys(VERDICT_JSON_SCHEMA.properties).sort()).toEqual(
    [...schemaKeys, "untrusted", "inventory"].sort(),
  );
});

test("inventory is optional, so an older consumer of the verdict contract still parses", () => {
  expect([...VERDICT_JSON_SCHEMA.required]).not.toContain("inventory");
  expect(Object.keys(VERDICT_JSON_SCHEMA.properties.inventory.properties).sort()).toEqual([
    "analyzed",
    "coverage",
    "notes",
    "total",
  ]);
});

test("untrusted is optional so the verdict contract stays backwards compatible", () => {
  expect([...VERDICT_JSON_SCHEMA.required]).not.toContain("untrusted");
  expect(VERDICT_JSON_SCHEMA.properties.untrusted.additionalProperties.type).toBe("string");
});

test("category enum in schema matches CATEGORIES", () => {
  expect([...VERDICT_JSON_SCHEMA.properties.categories.items.enum]).toEqual(CATEGORIES);
});

test("exit codes", () => {
  expect(exitCodeFor("allow")).toBe(0);
  expect(exitCodeFor("warn")).toBe(10);
  expect(exitCodeFor("block")).toBe(20);
});
