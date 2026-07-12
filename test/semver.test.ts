import { describe, expect, it } from "bun:test";
import { compareVersions, maxSatisfying, parseVersion } from "../src/utils/semver.js";

const V = [
  "0.0.3",
  "0.2.3",
  "0.2.9",
  "1.0.0",
  "1.2.0",
  "1.2.3",
  "1.9.9",
  "2.0.0",
  "2.1.0-beta.1",
  "3.0.0",
];

describe("parseVersion", () => {
  it("parses plain, v-prefixed, prerelease and build versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion("v1.2.3")?.major).toBe(1);
    expect(parseVersion("1.2.3-beta.2")?.prerelease).toEqual(["beta", "2"]);
    expect(parseVersion("1.2.3+build.5")?.prerelease).toEqual([]);
  });

  it("rejects non-versions", () => {
    expect(parseVersion("^1.2.3")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("banana")).toBeNull();
  });
});

describe("compareVersions", () => {
  const p = (s: string) => {
    const v = parseVersion(s);
    if (!v) throw new Error(`unparseable version ${s}`);
    return v;
  };
  it("orders by major, minor, patch", () => {
    expect(compareVersions(p("2.0.0"), p("1.9.9"))).toBeGreaterThan(0);
    expect(compareVersions(p("1.2.0"), p("1.3.0"))).toBeLessThan(0);
    expect(compareVersions(p("1.2.3"), p("1.2.4"))).toBeLessThan(0);
    expect(compareVersions(p("1.2.3"), p("1.2.3"))).toBe(0);
  });

  it("ranks a prerelease below its release", () => {
    expect(compareVersions(p("1.0.0-alpha"), p("1.0.0"))).toBeLessThan(0);
    expect(compareVersions(p("1.0.0"), p("1.0.0-alpha"))).toBeGreaterThan(0);
  });

  it("compares prerelease identifiers numerically then lexically", () => {
    expect(compareVersions(p("1.0.0-2"), p("1.0.0-10"))).toBeLessThan(0);
    expect(compareVersions(p("1.0.0-1"), p("1.0.0-alpha"))).toBeLessThan(0);
    expect(compareVersions(p("1.0.0-alpha"), p("1.0.0-1"))).toBeGreaterThan(0);
    expect(compareVersions(p("1.0.0-alpha"), p("1.0.0-beta"))).toBeLessThan(0);
    expect(compareVersions(p("1.0.0-beta"), p("1.0.0-alpha"))).toBeGreaterThan(0);
    expect(compareVersions(p("1.0.0-alpha"), p("1.0.0-alpha.1"))).toBeLessThan(0);
    expect(compareVersions(p("1.0.0-alpha.1"), p("1.0.0-alpha"))).toBeGreaterThan(0);
    expect(compareVersions(p("1.0.0-alpha.1"), p("1.0.0-alpha.1"))).toBe(0);
  });
});

describe("maxSatisfying", () => {
  it("resolves exact versions and misses", () => {
    expect(maxSatisfying(V, "1.2.3")).toBe("1.2.3");
    expect(maxSatisfying(V, "=1.2.3")).toBe("1.2.3");
    expect(maxSatisfying(V, "1.2.4")).toBeUndefined();
  });

  it("resolves caret ranges with 0.x rules", () => {
    expect(maxSatisfying(V, "^1.2.0")).toBe("1.9.9");
    expect(maxSatisfying(V, "^1")).toBe("1.9.9");
    expect(maxSatisfying(V, "^0.2.3")).toBe("0.2.9");
    expect(maxSatisfying(V, "^0.0.3")).toBe("0.0.3");
    expect(maxSatisfying(V, "^0.0")).toBe("0.0.3");
    expect(maxSatisfying(V, "^*")).toBe("3.0.0");
  });

  it("resolves tilde ranges", () => {
    expect(maxSatisfying(V, "~1.2.0")).toBe("1.2.3");
    expect(maxSatisfying(V, "~1.2")).toBe("1.2.3");
    expect(maxSatisfying(V, "~1")).toBe("1.9.9");
    expect(maxSatisfying(V, "~*")).toBe("3.0.0");
  });

  it("resolves wildcards and partials", () => {
    expect(maxSatisfying(V, "*")).toBe("3.0.0");
    expect(maxSatisfying(V, "x")).toBe("3.0.0");
    expect(maxSatisfying(V, "1")).toBe("1.9.9");
    expect(maxSatisfying(V, "1.x")).toBe("1.9.9");
    expect(maxSatisfying(V, "1.2")).toBe("1.2.3");
    expect(maxSatisfying(V, "1.2.x")).toBe("1.2.3");
    expect(maxSatisfying(V, "")).toBe("3.0.0");
  });

  it("resolves comparators, including partial bounds", () => {
    expect(maxSatisfying(V, ">=2.0.0")).toBe("3.0.0");
    expect(maxSatisfying(V, ">1.2.3")).toBe("3.0.0");
    expect(maxSatisfying(V, ">1")).toBe("3.0.0");
    expect(maxSatisfying(V, ">1.2")).toBe("3.0.0");
    expect(maxSatisfying(V, "<2.0.0")).toBe("1.9.9");
    expect(maxSatisfying(V, "<=1.2")).toBe("1.2.3");
    expect(maxSatisfying(V, "<=1")).toBe("1.9.9");
    expect(maxSatisfying(V, "<=1.2.3")).toBe("1.2.3");
  });

  it("resolves compound and OR ranges", () => {
    expect(maxSatisfying(V, ">=1.2.3 <2")).toBe("1.9.9");
    expect(maxSatisfying(V, "^0.2.3 || ^2.0.0")).toBe("2.0.0");
    expect(maxSatisfying(V, ">=9 || <1")).toBe("0.2.9");
  });

  it("skips prereleases and unparseable list entries", () => {
    expect(maxSatisfying(V, ">=2.1.0")).toBe("3.0.0");
    expect(maxSatisfying(["not-a-version", "1.0.0"], "*")).toBe("1.0.0");
  });

  it("returns undefined for unsupported range syntax", () => {
    expect(maxSatisfying(V, "latest")).toBeUndefined();
    expect(maxSatisfying(V, "workspace:*")).toBeUndefined();
    expect(maxSatisfying(V, ">=banana")).toBeUndefined();
  });
});
