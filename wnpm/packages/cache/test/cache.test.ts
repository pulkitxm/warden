import { test, expect } from "bun:test";
import { VerdictCache } from "../src/index.ts";
import type { Verdict } from "@warden/schema";

const verdict: Verdict = {
  schema_version: 1,
  package: "x",
  version: "1.0.0",
  integrity: "sha512-abc",
  verdict: "allow",
  risk_score: 0,
  categories: [],
  summary: "clean",
  evidence: [],
  analyzer_version: "0.1.0",
  source: "heuristics",
};

test("get miss, set, get hit marks source=cache", () => {
  const c = new VerdictCache(":memory:");
  expect(c.get("sha512-abc", "0.1.0")).toBeNull();
  c.set("sha512-abc", verdict, 1);
  const hit = c.get("sha512-abc", "0.1.0");
  expect(hit?.source).toBe("cache");
  expect(hit?.package).toBe("x");
  expect(c.size()).toBe(1);
});

test("stale analyzer version invalidates the entry", () => {
  const c = new VerdictCache(":memory:");
  c.set("sha512-abc", verdict, 1);
  expect(c.get("sha512-abc", "0.2.0")).toBeNull(); // analyzer bumped -> miss
  expect(c.get("sha512-abc", "0.1.0")).not.toBeNull();
});
