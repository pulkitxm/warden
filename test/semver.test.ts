import { expect, test } from "bun:test";
import {
  cmp,
  compareVersions,
  diffLevel,
  maxSatisfying,
  minSatisfying,
  parseVersion,
  satisfies,
  sortVersions,
} from "../src/semver.ts";

test("parseVersion handles full versions, prefixes, prerelease, and build metadata", () => {
  expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  expect(parseVersion("=1.2.3+build.5")?.patch).toBe(3);
  expect(parseVersion("1.2.3-beta.1")?.prerelease).toEqual(["beta", "1"]);
  expect(parseVersion("1.2")).toBeNull();
  expect(parseVersion("not-a-version")).toBeNull();
});

test("compareVersions orders core versions and tolerates invalid input", () => {
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  expect(compareVersions("1.2.3", "1.3.0")).toBeLessThan(0);
  expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
  expect(compareVersions("bogus", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0", "bogus")).toBeGreaterThan(0);
  expect(compareVersions("bogus", "junk")).toBe(0);
});

test("prerelease ordering follows semver precedence", () => {
  expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.11")).toBeLessThan(0);
  expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-1")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.alpha")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
});

test("cmp compares parsed versions directly", () => {
  const a = parseVersion("1.0.0");
  const b = parseVersion("1.0.1");
  expect(cmp(a!, b!)).toBeLessThan(0);
});

test("sortVersions returns an ascending copy", () => {
  const input = ["2.0.0", "1.0.0", "1.10.0", "1.2.0"];
  expect(sortVersions(input)).toEqual(["1.0.0", "1.2.0", "1.10.0", "2.0.0"]);
  expect(input[0]).toBe("2.0.0");
});

test("diffLevel classifies upgrade distance", () => {
  expect(diffLevel("1.0.0", "2.0.0")).toBe("major");
  expect(diffLevel("1.0.0", "1.1.0")).toBe("minor");
  expect(diffLevel("1.0.0", "1.0.1")).toBe("patch");
  expect(diffLevel("1.0.0-alpha", "1.0.0")).toBe("patch");
  expect(diffLevel("1.0.0", "1.0.0")).toBe("none");
  expect(diffLevel("junk", "1.0.0")).toBe("major");
});

test("satisfies: exact, wildcard, and empty ranges", () => {
  expect(satisfies("1.2.3", "1.2.3")).toBe(true);
  expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  expect(satisfies("9.9.9", "*")).toBe(true);
  expect(satisfies("9.9.9", "")).toBe(true);
  expect(satisfies("9.9.9", "x")).toBe(true);
  expect(satisfies("not-a-version", "*")).toBe(false);
});

test("satisfies: caret ranges", () => {
  expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
  expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
  expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
  expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
  expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
  expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
  expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
  expect(satisfies("1.5.0", "^1.2")).toBe(true);
  expect(satisfies("0.0.9", "^0.0")).toBe(true);
  expect(satisfies("0.1.0", "^0.0")).toBe(false);
  expect(satisfies("1.0.0", "^x")).toBe(true);
});

test("satisfies: tilde ranges", () => {
  expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
  expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  expect(satisfies("1.9.0", "~1")).toBe(true);
  expect(satisfies("2.0.0", "~1")).toBe(false);
  expect(satisfies("1.2.5", "~1.2")).toBe(true);
  expect(satisfies("1.0.0", "~x")).toBe(true);
});

test("satisfies: comparison operators including partial versions", () => {
  expect(satisfies("1.2.3", ">=1.2.3")).toBe(true);
  expect(satisfies("1.2.2", ">=1.2.3")).toBe(false);
  expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
  expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
  expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
  expect(satisfies("1.2.4", "<=1.2.3")).toBe(false);
  expect(satisfies("1.2.2", "<1.2.3")).toBe(true);
  expect(satisfies("1.2.3", "<1.2.3")).toBe(false);
  expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
  expect(satisfies("1.3.0", ">1.2")).toBe(true);
  expect(satisfies("1.2.9", ">1.2")).toBe(false);
  expect(satisfies("1.2.9", "<=1.2")).toBe(true);
  expect(satisfies("1.3.0", "<=1.2")).toBe(false);
  expect(satisfies("1.1.9", "<1.2")).toBe(true);
  expect(satisfies("2.0.0", ">1")).toBe(true);
  expect(satisfies("1.5.0", ">1")).toBe(false);
  expect(satisfies("1.2.0", ">=1.2")).toBe(true);
  expect(satisfies("1.5.0", "=1")).toBe(true);
  expect(satisfies("2.0.0", "=1")).toBe(false);
  expect(satisfies("0.0.1", "<*")).toBe(false);
  expect(satisfies("9.0.0", ">=*")).toBe(true);
});

test("satisfies: x-ranges and bare majors", () => {
  expect(satisfies("1.5.0", "1")).toBe(true);
  expect(satisfies("2.0.0", "1")).toBe(false);
  expect(satisfies("1.2.5", "1.2.x")).toBe(true);
  expect(satisfies("1.3.0", "1.2.x")).toBe(false);
  expect(satisfies("1.9.9", "1.x")).toBe(true);
});

test("satisfies: compound ranges, unions, and hyphen ranges", () => {
  expect(satisfies("1.5.0", ">=1.2.0 <2.0.0")).toBe(true);
  expect(satisfies("2.1.0", ">=1.2.0 <2.0.0")).toBe(false);
  expect(satisfies("2.5.0", "^1.0.0 || ^2.0.0")).toBe(true);
  expect(satisfies("3.0.0", "^1.0.0 || ^2.0.0")).toBe(false);
  expect(satisfies("1.5.0", "1.2.3 - 2.0.0")).toBe(true);
  expect(satisfies("2.0.1", "1.2.3 - 2.0.0")).toBe(false);
  expect(satisfies("1.5.0", "1.2 - 2")).toBe(true);
  expect(satisfies("1.0.0", "garbage || ^1.0.0")).toBe(true);
  expect(satisfies("1.0.0", "garbage")).toBe(false);
  expect(satisfies("1.0.0", "* x 1.0.0")).toBe(true);
  expect(satisfies("1.0.0", "bad - range")).toBe(false);
  expect(satisfies("1.0.0", "1.0.0 - junk")).toBe(false);
});

test("satisfies: prerelease versions require a prerelease comparator on the same tuple", () => {
  expect(satisfies("1.0.0-beta.2", ">=1.0.0-beta.1")).toBe(true);
  expect(satisfies("2.0.0-beta.1", ">=1.0.0")).toBe(false);
  expect(satisfies("1.0.0-beta.1", "*")).toBe(false);
  expect(satisfies("1.0.0-beta.2", "^1.0.0-beta.1")).toBe(true);
});

test("minSatisfying and maxSatisfying pick range endpoints", () => {
  const versions = ["1.0.0", "1.2.0", "1.4.0", "2.0.0"];
  expect(minSatisfying(versions, "^1.2.0")).toBe("1.2.0");
  expect(maxSatisfying(versions, "^1.0.0")).toBe("1.4.0");
  expect(minSatisfying(versions, "^3.0.0")).toBeUndefined();
  expect(maxSatisfying(versions, "^3.0.0")).toBeUndefined();
});
