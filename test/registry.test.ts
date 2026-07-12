import { afterEach, describe, expect, it } from "bun:test";
import { resolvePackage } from "../src/registry.js";
import { jsonResponse, stubFetch } from "./helpers/fetchStub.js";

const REG = "https://registry.npmjs.org";
const DL = "https://api.npmjs.org/downloads/point/last-week";

function packument(overrides: Record<string, unknown> = {}) {
  return {
    name: "demo",
    "dist-tags": { latest: "2.0.0", beta: "3.0.0-beta.1" },
    time: {
      "1.0.0": "2024-01-01T00:00:00Z",
      "2.0.0": "2025-01-01T00:00:00Z",
      "3.0.0-beta.1": "2025-06-01T00:00:00Z",
    },
    versions: {
      "1.0.0": {
        version: "1.0.0",
        maintainers: [{ name: "alice" }],
        dist: { tarball: `${REG}/demo/-/demo-1.0.0.tgz` },
        scripts: { build: "tsc" },
      },
      "2.0.0": {
        version: "2.0.0",
        maintainers: ["bob <bob@x.test>"],
        dist: { tarball: `${REG}/demo/-/demo-2.0.0.tgz` },
        scripts: { build: "tsc", postinstall: "node s.js" },
        deprecated: "use v3",
        repository: "git+https://github.com/x/demo.git",
      },
      "3.0.0-beta.1": {
        version: "3.0.0-beta.1",
        dist: { tarball: `${REG}/demo/-/demo-3.0.0-beta.1.tgz` },
      },
    },
    ...overrides,
  };
}

let restore = () => {};
afterEach(() => restore());

function stubRegistry(pack: unknown, downloads: unknown = { downloads: 1234 }) {
  restore = stubFetch((url) => {
    if (url.startsWith(`${DL}/`)) {
      if (downloads instanceof Error) return undefined;
      return jsonResponse(downloads);
    }
    if (url.startsWith(`${REG}/`)) return jsonResponse(pack);
    return undefined;
  });
}

describe("resolvePackage", () => {
  it("resolves latest via dist-tags with full metadata", async () => {
    stubRegistry(packument());
    const meta = await resolvePackage("demo");
    expect(meta.version).toBe("2.0.0");
    expect(meta.previousVersion).toBe("1.0.0");
    expect(meta.maintainers).toEqual(["bob"]);
    expect(meta.previousMaintainers).toEqual(["alice"]);
    expect(meta.deprecated).toBe("use v3");
    expect(meta.repositoryUrl).toBe("https://github.com/x/demo");
    expect(meta.weeklyDownloads).toBe(1234);
    expect(meta.scripts?.postinstall).toBe("node s.js");
    expect(meta.previousScripts?.build).toBe("tsc");
    expect(meta.ageDays).toBeGreaterThan(0);
    expect(meta.tarballUrl).toContain("demo-2.0.0.tgz");
    expect(meta.previousTarballUrl).toContain("demo-1.0.0.tgz");
  });

  it("resolves an exact version and a dist-tag", async () => {
    stubRegistry(packument());
    expect((await resolvePackage("demo", "1.0.0")).version).toBe("1.0.0");
    expect((await resolvePackage("demo", "beta")).version).toBe("3.0.0-beta.1");
  });

  it("resolves semver ranges instead of failing open", async () => {
    stubRegistry(packument());
    expect((await resolvePackage("demo", "^1.0.0")).version).toBe("1.0.0");
    expect((await resolvePackage("demo", ">=1")).version).toBe("2.0.0");
    expect((await resolvePackage("demo", "1.x")).version).toBe("1.0.0");
  });

  it("throws on a missing exact version rather than falling back", async () => {
    stubRegistry(packument());
    expect(resolvePackage("demo", "9.9.9")).rejects.toThrow('no version matching "9.9.9"');
  });

  it("throws on an unresolvable range", async () => {
    stubRegistry(packument());
    expect(resolvePackage("demo", "^9")).rejects.toThrow("no version matching");
  });

  it("throws when the packument fetch fails", async () => {
    restore = stubFetch(() => jsonResponse({ error: "not found" }, 404));
    expect(resolvePackage("nope")).rejects.toThrow("404");
  });

  it("falls back to newest ordered version when dist-tags are missing", async () => {
    const pack = packument({ "dist-tags": undefined });
    stubRegistry(pack);
    const meta = await resolvePackage("demo");
    expect(meta.version).toBe("3.0.0-beta.1");
  });

  it("throws when a dist-tag points at a missing version", async () => {
    stubRegistry(packument({ "dist-tags": { latest: "9.0.0" } }));
    expect(resolvePackage("demo")).rejects.toThrow("not found in packument");
  });

  it("orders versions by publish time with missing time entries", async () => {
    const pack = packument({ time: { "2.0.0": "2025-01-01T00:00:00Z" } });
    stubRegistry(pack);
    const meta = await resolvePackage("demo", "2.0.0");
    expect(meta.versions[meta.versions.length - 1]).toBe("2.0.0");
    expect(meta.ageDays).toBeGreaterThan(0);
  });

  it("handles absent publish time, repository and maintainer fields", async () => {
    const pack = {
      name: "bare",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { version: "1.0.0" } },
    };
    stubRegistry(pack);
    const meta = await resolvePackage("bare");
    expect(meta.ageDays).toBeUndefined();
    expect(meta.repositoryUrl).toBeUndefined();
    expect(meta.maintainers).toEqual([]);
    expect(meta.previousVersion).toBeUndefined();
    expect(meta.deprecated).toBe(false);
  });

  it("normalizes repository objects and git protocols", async () => {
    const pack = packument();
    (pack.versions["2.0.0"] as Record<string, unknown>).repository = {
      url: "git://github.com/x/demo.git",
    };
    stubRegistry(pack);
    expect((await resolvePackage("demo")).repositoryUrl).toBe("https://github.com/x/demo");
  });

  it("treats a repository object without url as absent", async () => {
    const pack = packument();
    (pack.versions["2.0.0"] as Record<string, unknown>).repository = {};
    (pack as Record<string, unknown>).repository = undefined;
    stubRegistry(pack);
    expect((await resolvePackage("demo")).repositoryUrl).toBeUndefined();
  });

  it("URL-encodes scoped names", async () => {
    let requested = "";
    restore = stubFetch((url) => {
      if (url.startsWith(`${DL}/`)) return jsonResponse({ downloads: 5 });
      requested = url;
      return jsonResponse({
        name: "@scope/pkg",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { version: "1.0.0" } },
      });
    });
    await resolvePackage("@scope/pkg");
    expect(requested).toBe(`${REG}/@scope%2Fpkg`);
  });

  it("survives a downloads-API failure and a non-numeric payload", async () => {
    stubRegistry(packument(), new Error("down"));
    expect((await resolvePackage("demo")).weeklyDownloads).toBeUndefined();
    stubRegistry(packument(), { downloads: "many" });
    expect((await resolvePackage("demo")).weeklyDownloads).toBeUndefined();
  });

  it("honors WARDEN_REGISTRY and WARDEN_DOWNLOADS at call time", async () => {
    process.env.WARDEN_REGISTRY = "https://mirror.test";
    process.env.WARDEN_DOWNLOADS = "https://dl.test";
    const urls: string[] = [];
    restore = stubFetch((url) => {
      urls.push(url);
      if (url.startsWith("https://dl.test/")) return jsonResponse({ downloads: 7 });
      return jsonResponse({
        name: "demo",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { version: "1.0.0" } },
      });
    });
    const meta = await resolvePackage("demo");
    delete process.env.WARDEN_REGISTRY;
    delete process.env.WARDEN_DOWNLOADS;
    expect(meta.weeklyDownloads).toBe(7);
    expect(urls[0]).toBe("https://mirror.test/demo");
  });
});
