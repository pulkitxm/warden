import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerdictCache } from "../src/cache.ts";
import type { Verdict } from "../src/schema.ts";

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
  expect(c.get("sha512-abc", "0.2.0")).toBeNull();
  expect(c.get("sha512-abc", "0.1.0")).not.toBeNull();
});

test("a cache path in a directory that does not exist yet is created on first run", () => {
  const path = join(tmpdir(), `wnpm-cache-${Date.now()}-${Math.random()}`, "deep", "v.sqlite");
  expect(existsSync(path)).toBe(false);
  const c = new VerdictCache(path);
  c.set("sha512-abc", verdict, 1);
  expect(c.get("sha512-abc", "0.1.0")?.source).toBe("cache");
  expect(existsSync(path)).toBe(true);
});
