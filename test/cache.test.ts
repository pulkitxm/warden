import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, FileVerdictCache, MemoryVerdictCache } from "../src/cache/index.js";
import type { Verdict } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "warden-cache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function verdict(pkg: string): Verdict {
  return {
    package: pkg,
    risk_score: 1,
    level: "LOW",
    flags: [],
    evidence: [],
    explanation: "ok",
    recommendation: "allow",
    cached: false,
    engine_version: "0.1.0",
    llm_used: false,
  };
}

describe("cacheKey", () => {
  it("joins name and version", () => {
    expect(cacheKey("@scope/pkg", "1.2.3")).toBe("@scope/pkg@1.2.3");
  });
});

describe("FileVerdictCache", () => {
  it("uses WARDEN_CACHE_DIR when no dir is given", async () => {
    const prev = process.env.WARDEN_CACHE_DIR;
    process.env.WARDEN_CACHE_DIR = join(dir, "from-env");
    const cache = new FileVerdictCache();
    await cache.set("env@1.0.0", verdict("env@1.0.0"));
    expect((await cache.get("env@1.0.0"))?.package).toBe("env@1.0.0");
    if (prev === undefined) delete process.env.WARDEN_CACHE_DIR;
    else process.env.WARDEN_CACHE_DIR = prev;
  });

  it("round-trips a verdict and marks reads as cached", async () => {
    const cache = new FileVerdictCache(join(dir, "a"));
    await cache.set("left-pad@1.3.0", verdict("left-pad@1.3.0"));
    const hit = await cache.get("left-pad@1.3.0");
    expect(hit?.cached).toBe(true);
    expect(hit?.package).toBe("left-pad@1.3.0");
  });

  it("returns undefined on a miss", async () => {
    const cache = new FileVerdictCache(join(dir, "a"));
    expect(await cache.get("nope@0.0.0")).toBeUndefined();
  });

  it("counts entries", async () => {
    const cache = new FileVerdictCache(join(dir, "b"));
    expect(await cache.size()).toBe(0);
    await cache.set("x@1.0.0", verdict("x@1.0.0"));
    await cache.set("y@1.0.0", verdict("y@1.0.0"));
    expect(await cache.size()).toBe(2);
  });

  it("reports size 0 when the directory is unreadable", async () => {
    const cache = new FileVerdictCache(join(dir, "c"));
    await cache.set("z@1.0.0", verdict("z@1.0.0"));
    rmSync(join(dir, "c"), { recursive: true, force: true });
    expect(await cache.size()).toBe(0);
  });
});

describe("MemoryVerdictCache", () => {
  it("round-trips and flags cached reads", async () => {
    const cache = new MemoryVerdictCache();
    expect(await cache.get("a@1.0.0")).toBeUndefined();
    await cache.set("a@1.0.0", verdict("a@1.0.0"));
    expect((await cache.get("a@1.0.0"))?.cached).toBe(true);
    expect(await cache.size()).toBe(1);
  });
});
