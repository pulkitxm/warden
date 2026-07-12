import { test, expect, afterEach } from "bun:test";
import { explain, llmStats } from "../src/index.ts";
import type { Verdict } from "@warden/schema";

const V: Verdict = {
  schema_version: 1,
  package: "evil-pkg",
  version: "1.0.0",
  integrity: "sha512-x",
  verdict: "block",
  risk_score: 90,
  categories: ["exfiltration"],
  summary: "template",
  evidence: [{ file: "s.js", detail: "sends env to a raw IP" }],
  analyzer_version: "0.1.0",
  source: "heuristics",
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENAI_API_KEY;
});

test("no API key -> template, no model call", async () => {
  delete process.env.OPENAI_API_KEY;
  const before = llmStats.calls;
  const r = await explain(V);
  expect(r.used).toBe(false);
  expect(llmStats.calls).toBe(before);
});

test("valid structured response -> parsed summary, counted", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "This package exfiltrates environment variables." }) } }] }), { status: 200 })) as unknown as typeof fetch;
  const before = llmStats.calls;
  const r = await explain(V);
  expect(r.used).toBe(true);
  expect(r.summary).toBe("This package exfiltrates environment variables.");
  expect(llmStats.calls).toBe(before + 1);
});

test("malformed response -> falls back to template", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response("not json at all", { status: 200 })) as unknown as typeof fetch;
  const r = await explain(V);
  expect(r.used).toBe(false);
  expect(r.summary).toContain("evil-pkg");
});

test("unbalanced JSON braces in the model output -> template", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"summary": "truncated' } }] }), { status: 200 })) as unknown as typeof fetch;
  const r = await explain(V);
  expect(r.used).toBe(false);
  expect(r.summary).toContain("evil-pkg");
});

test("HTTP error -> falls back to template", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  const r = await explain(V);
  expect(r.used).toBe(false);
});

test("allow verdict never calls the model (escalation gate)", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const r = await explain({ ...V, verdict: "allow" });
  expect(called).toBe(false);
  expect(r.used).toBe(false);
});
