import { test, expect, beforeAll, afterAll } from "bun:test";
import { startMiniRegistry, type MiniRegistry } from "../../fixtures/registry/server.ts";
import { checkPackage } from "../../src/engine.ts";
import { VerdictCache } from "../../src/cache.ts";
import { Blocklist } from "../../src/intel/index.ts";

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry();
  process.env.WARDEN_REGISTRY = reg.url;
  process.env.WARDEN_DOWNLOADS = reg.downloadsUrl;
});
afterAll(() => reg.stop());

const cache = () => new VerdictCache(":memory:");

test("clean popular package -> allow", async () => {
  const v = await checkPackage("left-pad", { cache: cache() });
  expect(v.verdict).toBe("allow");
});

test("typosquat -> block for typosquat", async () => {
  const v = await checkPackage("lodahs", { cache: cache() });
  expect(v.verdict).toBe("block");
  expect(v.categories).toContain("typosquat");
});

test("hijacked-legit diff (provenance downgrade + exfil) -> block", async () => {
  const v = await checkPackage("acme-http@1.0.1", { cache: cache() });
  expect(v.verdict).toBe("block");
  expect(v.categories).toContain("provenance_downgrade");
  expect(v.categories).toContain("exfiltration");
});

test("nonexistent name -> slopsquat block (registry 404)", async () => {
  const v = await checkPackage("react-codeshift", { cache: cache() });
  expect(v.verdict).toBe("block");
  expect(v.categories).toContain("slopsquat");
});

test("blocklisted version -> instant block from the blocklist", async () => {
  const v = await checkPackage("chalk@5.6.1", { cache: cache() });
  expect(v.verdict).toBe("block");
  expect(v.source).toBe("blocklist");
});

test("integrity-keyed cache: second check is a cache hit", async () => {
  const shared = cache();
  const first = await checkPackage("acme-http@1.0.1", { cache: shared });
  expect(first.source).not.toBe("cache");
  const second = await checkPackage("acme-http@1.0.1", { cache: shared });
  expect(second.source).toBe("cache");
  expect(second.integrity).toBe(first.integrity);
  expect(second.verdict).toBe(first.verdict);
});

test("missing exact version does not fall back to latest (errors instead)", async () => {
  // left-pad exists but @9.9.9 does not; must NOT silently analyze latest.
  await expect(checkPackage("left-pad@9.9.9", { cache: cache() })).rejects.toThrow(/not found/);
});

test("verdict validates the schema shape (agent contract)", async () => {
  const v = await checkPackage("lodahs", { cache: cache(), blocklist: new Blocklist([]) });
  for (const key of ["schema_version", "package", "version", "integrity", "verdict", "risk_score", "categories", "summary", "evidence", "analyzer_version", "source"]) {
    expect(v).toHaveProperty(key);
  }
});
