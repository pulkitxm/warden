/** Engine edge paths not reachable through the demo fixtures: registry-404
 * slopsquat, blocklisted-but-removed versions, and tarball integrity mismatch. */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { startMiniRegistry, type MiniRegistry } from "../../fixtures/registry/server.ts";
import { pkgJson, type FixturePackage } from "../../fixtures/registry/fixtures.ts";
import { checkPackage } from "../../src/engine.ts";
import { VerdictCache } from "../../src/cache.ts";
import { Blocklist } from "../../src/intel/index.ts";
import { computeIntegrity } from "../../src/integrity.ts";

const maintainer = { name: "edge", email: "edge@example.com" };
const EDGE_FIXTURES: FixturePackage[] = [
  // Exists, but any other requested version is "removed".
  {
    name: "ghost-pkg",
    downloads: 10,
    latest: "1.0.0",
    versions: { "1.0.0": { files: [pkgJson("ghost-pkg", "1.0.0")], maintainer, ageHours: 100 } },
  },
  // The previous version's tarball is gone (fetch 404s) -> metadata-only diff.
  {
    name: "prevless-pkg",
    downloads: 500_000,
    latest: "1.1.0",
    versions: {
      "1.0.0": { files: [pkgJson("prevless-pkg", "1.0.0")], maintainer, ageHours: 9000, missingTarball: true },
      "1.1.0": { files: [pkgJson("prevless-pkg", "1.1.0")], maintainer, ageHours: 8000 },
    },
  },
  // Packument advertises an integrity that does not match the tarball bytes.
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
  expect(v.integrity).toBe(""); // no bytes to address — the version is gone
  expect(v.summary).toContain("MAL-TEST-0001");
});

test("removed version NOT on the blocklist -> error (never falls back)", async () => {
  const bl = new Blocklist([]);
  await expect(checkPackage("ghost-pkg@6.6.6", { cache: cache(), blocklist: bl })).rejects.toThrow(/not found/);
});

test("missing previous tarball falls back to a metadata-only diff", async () => {
  const v = await checkPackage("prevless-pkg@1.1.0", { cache: cache() });
  expect(v.verdict).toBe("allow"); // clean update; the lost previous tarball is not an alarm
});

test("tarball integrity mismatch -> hard error, never scored", async () => {
  await expect(checkPackage("tampered-pkg@2.0.0", { cache: cache() })).rejects.toThrow(/integrity mismatch/);
});
