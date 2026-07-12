import { afterEach, describe, expect, it } from "bun:test";
import { enrich } from "../src/enrich/index.js";
import type { PackageMeta } from "../src/types.js";
import { jsonResponse, stubFetch } from "./helpers/fetchStub.js";

const meta: PackageMeta = {
  name: "demo",
  version: "1.0.0",
  versions: ["1.0.0"],
  maintainers: [],
};

let restore = () => {};
afterEach(() => restore());

describe("enrich", () => {
  it("reports known vulnerabilities from OSV", async () => {
    restore = stubFetch((url) => {
      if (url.includes("osv.dev")) {
        return jsonResponse({ vulns: [{ id: "GHSA-1" }, { id: "GHSA-2" }] });
      }
      return jsonResponse({ licenses: ["MIT"] });
    });
    const signals = await enrich(meta);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.flag).toBe("known_vulnerability");
    expect(signals[0]?.evidence).toContain("GHSA-1");
    expect(signals[0]?.weight).toBeLessThanOrEqual(4);
  });

  it("reports copyleft licenses from deps.dev", async () => {
    restore = stubFetch((url) => {
      if (url.includes("osv.dev")) return jsonResponse({});
      return jsonResponse({ licenses: ["AGPL-3.0", "MIT"] });
    });
    const signals = await enrich(meta);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.flag).toBe("license_copyleft");
    expect(signals[0]?.evidence).toContain("AGPL-3.0");
  });

  it("returns nothing for a clean, permissively-licensed package", async () => {
    restore = stubFetch((url) => {
      if (url.includes("osv.dev")) return jsonResponse({ vulns: [] });
      return jsonResponse({ licenses: ["MIT"] });
    });
    expect(await enrich(meta)).toEqual([]);
  });

  it("swallows total API failure (never fatal)", async () => {
    restore = stubFetch(() => undefined);
    expect(await enrich(meta)).toEqual([]);
  });

  it("handles missing license data", async () => {
    restore = stubFetch((url) => {
      if (url.includes("osv.dev")) return jsonResponse({});
      return jsonResponse({});
    });
    expect(await enrich(meta)).toEqual([]);
  });
});
