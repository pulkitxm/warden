import { test, expect } from "bun:test";
import { damerau, normalize, findNearestPopular } from "../src/distance/index.ts";

test("damerau reference table", () => {
  expect(damerau("lodash", "lodahs")).toBe(1); // transposition
  expect(damerau("chalk", "chlak")).toBe(1); // transposition
  expect(damerau("react", "react")).toBe(0);
  expect(damerau("kitten", "sitting")).toBe(3); // classic
  expect(damerau("", "abc")).toBe(3);
});

test("normalize folds homoglyphs and delimiters", () => {
  expect(normalize("cr0ss-env")).toBe("crossenv");
  expect(normalize("@scope/Cross_Env")).toBe("crossenv");
  expect(normalize("l0dash")).toBe("lodash");
});

test("finds a distance-1 typosquat", () => {
  const m = findNearestPopular("lodahs");
  expect(m?.target).toBe("lodash");
  expect(m?.distance).toBe(1);
});

test("real package returns null (not a squat of itself)", () => {
  expect(findNearestPopular("lodash")).toBeNull();
  expect(findNearestPopular("react")).toBeNull();
});

test("homoglyph squat is a normalized collision and flagged as homoglyph", () => {
  const m = findNearestPopular("l0dash");
  expect(m?.target).toBe("lodash");
  expect(m?.normalizedCollision).toBe(true);
  expect(m?.homoglyph).toBe(true);
});

test("delimiter-only variant is a collision but NOT a homoglyph", () => {
  const m = findNearestPopular("cross_env");
  expect(m?.target).toBe("cross-env");
  expect(m?.normalizedCollision).toBe(true);
  expect(m?.homoglyph).toBe(false);
});

test("linear scan finds distance-2 matches a BK-tree over OSA missed", () => {
  const m = findNearestPopular("myr2sql");
  expect(m?.target).toBe("mysql");
  expect(m?.distance).toBe(2);
});

test("delimiter variant of a real package is detected but marked a collision", () => {
  // class-names vs classnames: a genuine near-collision. The distance package
  // surfaces it (normalizedCollision:true) but does NOT decide block — the
  // scorer's two-signal rule keeps this an allow/warn. See score FP corpus.
  const m = findNearestPopular("class-names");
  expect(m?.target).toBe("classnames");
  expect(m?.normalizedCollision).toBe(true);
});

test("short names are ignored", () => {
  expect(findNearestPopular("ab")).toBeNull();
});
