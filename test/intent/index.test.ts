import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { parseIntentArgs } from "../../src/intent/index.ts";
import { SCHEMA_VERSION } from "../../src/schema.ts";

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, out, err };
}

test("parseIntentArgs defaults to the check verb with no flags", () => {
  expect(parseIntentArgs([])).toEqual({
    verb: "check",
    prompt: undefined,
    base: undefined,
    json: false,
  });
});

test("parseIntentArgs reads verb, prompt, base, and json", () => {
  expect(parseIntentArgs(["extract", "--prompt", "add x", "--base", "main", "--json"])).toEqual({
    verb: "extract",
    prompt: "add x",
    base: "main",
    json: true,
  });
});

test("warden intent schema prints the intent report schema", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "schema"], state.deps)).toBe(0);
  const schema = JSON.parse(state.out.join("")) as {
    required: string[];
    properties: { schema_version: { const: number } };
  };
  expect(schema.properties.schema_version.const).toBe(SCHEMA_VERSION);
  expect(schema.required).toContain("claims");
  expect(schema.required).toContain("hallucinations");
  expect(schema.required).toContain("scope_creep");
});

test("unknown intent verb fails with a typed usage error", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "bogus"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain('unknown intent verb "bogus"');

  const jsonState = makeDeps();
  expect(await runWarden(["intent", "bogus", "--json"], jsonState.deps)).toBe(30);
  const envelope = JSON.parse(jsonState.out.join("")) as {
    error: { kind: string; code: string };
  };
  expect(envelope.error.kind).toBe("usage");
  expect(envelope.error.code).toBe("WARDEN_INTENT_ERROR");
});

test("an unknown flag surfaces as a typed analysis error", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "schema", "--nope"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("warden:");
});

test("warden intent --help renders the command help", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "--help"], state.deps)).toBe(0);
  expect(state.err.join("")).toContain("usage: warden intent [check|extract|diff|symbols|schema]");
});
