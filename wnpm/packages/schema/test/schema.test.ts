import { test, expect } from "bun:test";
import {
  VERDICT_JSON_SCHEMA,
  CATEGORIES,
  SCHEMA_VERSION,
  exitCodeFor,
  type Verdict,
} from "../src/index.ts";

// Drift guard: a representative Verdict object must have exactly the keys the
// JSON Schema requires — no more, no fewer. If someone adds a field to the type
// without updating the schema (or vice versa), this fails.
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
  // Every declared property is also a required key (no optional top-level fields).
  expect(Object.keys(VERDICT_JSON_SCHEMA.properties).sort()).toEqual(schemaKeys);
});

test("category enum in schema matches CATEGORIES", () => {
  expect([...VERDICT_JSON_SCHEMA.properties.categories.items.enum]).toEqual(CATEGORIES);
});

test("exit codes", () => {
  expect(exitCodeFor("allow")).toBe(0);
  expect(exitCodeFor("warn")).toBe(10);
  expect(exitCodeFor("block")).toBe(20);
});
