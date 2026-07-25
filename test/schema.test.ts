import { expect, test } from "bun:test";
import type { DoctorReport } from "../src/doctor/index.ts";
import {
  CATEGORIES,
  DOCTOR_JSON_SCHEMA,
  exitCodeFor,
  SCHEMA_VERSION,
  VERDICT_JSON_SCHEMA,
  type Verdict,
} from "../src/schema.ts";
import { type JsonSchemaNode, validate } from "./helpers/json-schema.ts";

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

test("the doctor JSON schema accepts a fully populated report", () => {
  const report: DoctorReport = {
    schema_version: SCHEMA_VERSION,
    project: "demo",
    issues: [
      {
        name: "acme-http",
        group: "prod",
        installed: "1.0.0",
        kind: "vulnerability",
        id: "GHSA-1",
        severity: "critical",
        summary: "request smuggling",
        fixedIn: "1.0.1",
      },
      { name: "old-lib", group: "dev", kind: "deprecated", summary: "deprecated" },
    ],
    gate: [
      {
        name: "acme-http",
        version: "1.0.1",
        verdict: "block",
        categories: ["exfiltration"],
        summary: "hijacked release",
      },
    ],
    unfixable: [{ name: "acme-http", reason: "all candidates blocked" }],
    plans: [
      {
        id: "minimal",
        label: "smallest safe upgrade",
        changes: [{ name: "acme-json", from: "2.1.0", to: "2.1.4", inRange: true, level: "patch" }],
        verification: { passed: true, steps: [{ name: "install", ok: true, ms: 120 }] },
      },
    ],
    recommended: "minimal",
    applied: true,
    audited: 2,
    skipped: 0,
    notes: ["left-pad: advisory lookup failed"],
  };
  expect(validate(DOCTOR_JSON_SCHEMA as JsonSchemaNode, report)).toEqual([]);
});

test("the doctor JSON schema accepts a minimal clean report", () => {
  const clean: DoctorReport = {
    schema_version: SCHEMA_VERSION,
    project: "clean",
    issues: [],
    gate: [],
    unfixable: [],
    plans: [],
    audited: 3,
    skipped: 0,
    notes: [],
  };
  expect(validate(DOCTOR_JSON_SCHEMA as JsonSchemaNode, clean)).toEqual([]);
});

test("the doctor JSON schema rejects drift from the published contract", () => {
  const missingKey = { schema_version: SCHEMA_VERSION, project: "x" };
  expect(validate(DOCTOR_JSON_SCHEMA as JsonSchemaNode, missingKey).length).toBeGreaterThan(0);

  const badVerdict = {
    schema_version: SCHEMA_VERSION,
    project: "x",
    issues: [],
    gate: [{ name: "a", version: "1.0.0", verdict: "explode", categories: [], summary: "" }],
    unfixable: [],
    plans: [],
    audited: 0,
    skipped: 0,
    notes: [],
  };
  expect(validate(DOCTOR_JSON_SCHEMA as JsonSchemaNode, badVerdict)).toContain(
    "$.gate[0].verdict: explode not in enum",
  );

  const extraKey = {
    schema_version: SCHEMA_VERSION,
    project: "x",
    issues: [],
    gate: [],
    unfixable: [],
    plans: [],
    audited: 0,
    skipped: 0,
    notes: [],
    surprise: true,
  };
  expect(validate(DOCTOR_JSON_SCHEMA as JsonSchemaNode, extraKey)).toContain(
    "$.surprise: unexpected key",
  );
});

test("the schema validator reports every kind of shape mismatch", () => {
  const objectSchema: JsonSchemaNode = { type: "object", properties: {}, required: [] };
  expect(validate(objectSchema, "not-an-object")).toEqual(["$: expected object"]);
  expect(validate(objectSchema, null)).toEqual(["$: expected object"]);
  expect(validate(objectSchema, [])).toEqual(["$: expected object"]);

  expect(validate({ type: "array", items: { type: "string" } }, "nope")).toEqual([
    "$: expected array",
  ]);
  expect(validate({ type: "array", items: { type: "string" } }, [1])).toEqual([
    "$[0]: expected string",
  ]);

  expect(validate({ type: "integer", const: 1 }, 2)).toEqual(["$: expected const 1"]);
  expect(validate({ type: "boolean" }, "yes")).toEqual(["$: expected boolean"]);
  expect(validate({ type: "integer" }, 1.5)).toEqual(["$: expected integer"]);
  expect(validate({ type: "number" }, "3")).toEqual(["$: expected number"]);
  expect(validate({ type: "string" }, 3)).toEqual(["$: expected string"]);

  const optional: JsonSchemaNode = {
    type: "object",
    properties: { a: { type: "string" } },
    required: [],
  };
  expect(validate(optional, { a: undefined })).toEqual([]);
  expect(validate({ type: "object", properties: {} }, { extra: 1 })).toEqual([]);
});
