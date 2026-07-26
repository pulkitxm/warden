import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolvePackage } from "../src/registry.ts";

const version = (v: string) => ({
  version: v,
  dist: { tarball: `http://localhost/demo-pkg-${v}.tgz`, integrity: `sha512-${v}` },
});

const packument = {
  name: "demo-pkg",
  "dist-tags": { latest: "2.1.0" },
  time: {
    "1.0.0": "2026-01-01T00:00:00.000Z",
    "1.4.2": "2026-02-01T00:00:00.000Z",
    "2.0.0": "2026-03-01T00:00:00.000Z",
    "2.1.0": "2026-04-01T00:00:00.000Z",
    "3.0.0-beta.1": "2026-05-01T00:00:00.000Z",
  },
  versions: {
    "1.0.0": version("1.0.0"),
    "1.4.2": version("1.4.2"),
    "2.0.0": version("2.0.0"),
    "2.1.0": version("2.1.0"),
    "3.0.0-beta.1": version("3.0.0-beta.1"),
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

test("a caret range resolves to the highest version that satisfies it", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  const meta = await resolvePackage("demo-pkg", "^1.0.0");
  expect(meta.existsOnRegistry).toBe(true);
  expect(meta.version).toBe("1.4.2");
  expect(meta.requestedVersionMissing).toBeFalsy();
});

test("a range is not mistaken for a version that was never published", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  for (const range of ["^2.0.0", ">=1.4.2 <2.0.0", "~1.4.0", "1.x", "*"]) {
    const meta = await resolvePackage("demo-pkg", range);
    expect(meta.existsOnRegistry).toBe(true);
    expect(meta.requestedVersionMissing).toBeFalsy();
  }
});

test("a prerelease is only chosen when the range asks for one", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  expect((await resolvePackage("demo-pkg", "^2.0.0")).version).toBe("2.1.0");
  expect((await resolvePackage("demo-pkg", "3.0.0-beta.1")).version).toBe("3.0.0-beta.1");
});

test("an exact version that was never published is still reported as missing", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  const meta = await resolvePackage("demo-pkg", "9.9.9");
  expect(meta.requestedVersionMissing).toBe(true);
});

test("a range no published version satisfies is reported as missing", async () => {
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  const meta = await resolvePackage("demo-pkg", "^9.0.0");
  expect(meta.requestedVersionMissing).toBe(true);
});
