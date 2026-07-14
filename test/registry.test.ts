import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolvePackage } from "../src/registry.ts";

const packument = {
  name: "demo-pkg",
  "dist-tags": { latest: "1.0.0" },
  time: { "1.0.0": "2026-01-01T00:00:00.000Z" },
  versions: {
    "1.0.0": {
      version: "1.0.0",
      dist: { tarball: "http://localhost/demo-pkg-1.0.0.tgz", integrity: "sha512-x" },
    },
  },
  maintainers: [{ name: "dev" }],
};

let server: ReturnType<typeof Bun.serve>;
const saved = { registry: process.env.WNPM_REGISTRY, downloads: process.env.WNPM_DOWNLOADS };
const DEAD = "http://127.0.0.1:1";

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: () => Response.json(packument) });
});

afterAll(() => {
  server.stop(true);
  if (saved.registry === undefined) delete process.env.WNPM_REGISTRY;
  else process.env.WNPM_REGISTRY = saved.registry;
  if (saved.downloads === undefined) delete process.env.WNPM_DOWNLOADS;
  else process.env.WNPM_DOWNLOADS = saved.downloads;
});

test("an unreachable registry raises an analysis error instead of a fake missing-package result", async () => {
  process.env.WNPM_REGISTRY = DEAD;
  expect(resolvePackage("anything")).rejects.toThrow("registry unreachable");
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
});

test("a 200 response with a non-JSON body resolves to not-on-registry", async () => {
  const junk = Bun.serve({ port: 0, fetch: () => new Response("<html>maintenance</html>") });
  try {
    process.env.WNPM_REGISTRY = `http://localhost:${junk.port}`;
    const meta = await resolvePackage("demo-pkg");
    expect(meta.existsOnRegistry).toBe(false);
  } finally {
    junk.stop(true);
    process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  }
});

test("a downloads-API outage is reported as unknown, not zero", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  process.env.WNPM_DOWNLOADS = DEAD;
  const meta = await resolvePackage("demo-pkg");
  expect(meta.existsOnRegistry).toBe(true);
  expect(meta.weeklyDownloads).toBeUndefined();
  expect(meta.downloadsUnknown).toBe(true);
});
