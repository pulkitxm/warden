import { describe, expect, it } from "bun:test";
import { editDistance, findTyposquat, POPULAR_PACKAGES } from "../src/heuristics/nameDistance.js";

describe("editDistance", () => {
  it("handles empty strings", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("", "")).toBe(0);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(editDistance("lodash", "lodahs")).toBe(1);
    expect(editDistance("react", "reactt")).toBe(1);
    expect(editDistance("axios", "axos")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("counts an adjacent transposition as one edit", () => {
    expect(editDistance("chalk", "chlak")).toBe(1);
    expect(editDistance("express", "exrpess")).toBe(1);
  });
});

describe("findTyposquat", () => {
  it("matches near-misses of popular packages", () => {
    expect(findTyposquat("lodahs")?.target).toBe("lodash");
    expect(findTyposquat("is0dd")?.target).toBe("is-odd");
    expect(findTyposquat("expresss")?.target).toBe("express");
  });

  it("returns null for the popular package itself", () => {
    for (const pkg of POPULAR_PACKAGES.slice(0, 5)) {
      expect(findTyposquat(pkg.name)).toBeNull();
    }
  });

  it("ignores the scope when comparing", () => {
    expect(findTyposquat("@types/lodahs")?.target).toBe("lodash");
  });

  it("returns null for very short names", () => {
    expect(findTyposquat("ab")).toBeNull();
    expect(findTyposquat("@scope/ab")).toBeNull();
  });

  it("rejects names whose length differs too much from the target", () => {
    expect(findTyposquat("reacted-components-kit")).toBeNull();
  });

  it("returns null when nothing is within the edit budget", () => {
    expect(findTyposquat("completely-unrelated-name")).toBeNull();
  });

  it("prefers the closest match and reports its popularity", () => {
    const m = findTyposquat("chal");
    expect(m?.target).toBe("chalk");
    expect(m?.distance).toBe(1);
    expect(m?.targetWeeklyDownloads).toBeGreaterThan(0);
  });
});
