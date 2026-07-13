import { afterAll, beforeAll, expect, test } from "bun:test";
import { type FixturePackage, pkgJson } from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { checkPackage } from "../../src/engine.ts";
import { computeIntegrity } from "../../src/integrity.ts";
import { Blocklist } from "../../src/intel/index.ts";

const maintainer = { name: "edge", email: "edge@example.com" };
const EDGE_FIXTURES: FixturePackage[] = [
  {
    name: "ghost-pkg",
    downloads: 10,
    latest: "1.0.0",
    versions: { "1.0.0": { files: [pkgJson("ghost-pkg", "1.0.0")], maintainer, ageHours: 100 } },
  },
  {
    name: "prevless-pkg",
    downloads: 500_000,
    latest: "1.1.0",
    versions: {
      "1.0.0": {
        files: [pkgJson("prevless-pkg", "1.0.0")],
        maintainer,
        ageHours: 9000,
        missingTarball: true,
      },
      "1.1.0": { files: [pkgJson("prevless-pkg", "1.1.0")], maintainer, ageHours: 8000 },
    },
  },
  {
    name: "tampered-pkg",
    downloads: 500_000,
    latest: "2.0.0",
    versions: {
      "2.0.0": {
        files: [pkgJson("tampered-pkg", "2.0.0")],
        maintainer,
        ageHours: 9000,
        integrity: computeIntegrity(new TextEncoder().encode("not the real tarball")),
      },
    },
  },
];

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry(0, { only: true, fixtures: EDGE_FIXTURES });
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => reg.stop());

const cache = () => new VerdictCache(":memory:");

test("registry 404 for a name NOT on the hallucinated list -> heuristic slopsquat block", async () => {
  const v = await checkPackage("wnpm-surely-not-a-real-package", { cache: cache() });
  expect(v.verdict).toBe("block");
  expect(v.categories).toContain("slopsquat");
  expect(v.source).toBe("heuristics");
  expect(v.integrity).toBe("");
});

test("removed version that is on the blocklist -> still hard-blocked", async () => {
  const bl = new Blocklist([{ id: "MAL-TEST-0001", name: "ghost-pkg", versions: ["6.6.6"] }]);
  const v = await checkPackage("ghost-pkg@6.6.6", { cache: cache(), blocklist: bl });
  expect(v.verdict).toBe("block");
  expect(v.source).toBe("blocklist");
  expect(v.integrity).toBe("");
  expect(v.summary).toContain("MAL-TEST-0001");
});

test("removed version NOT on the blocklist -> error (never falls back)", async () => {
  const bl = new Blocklist([]);
  await expect(checkPackage("ghost-pkg@6.6.6", { cache: cache(), blocklist: bl })).rejects.toThrow(
    /not found/,
  );
});

test("missing previous tarball falls back to a metadata-only diff", async () => {
  const v = await checkPackage("prevless-pkg@1.1.0", { cache: cache() });
  expect(v.verdict).toBe("allow");
});

test("tarball integrity mismatch -> hard error, never scored", async () => {
  await expect(checkPackage("tampered-pkg@2.0.0", { cache: cache() })).rejects.toThrow(
    /integrity mismatch/,
  );
});
