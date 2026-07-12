import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { computeIntegrity, verifyIntegrity, parseIntegrity, assertIntegrity, IntegrityError } from "../src/index.ts";

const data = new TextEncoder().encode("hello warden");

test("compute matches node:crypto reference (sha512)", () => {
  const ref = "sha512-" + createHash("sha512").update(data).digest("base64");
  expect(computeIntegrity(data)).toBe(ref);
});

test("verify accepts matching, rejects tampered", () => {
  const sri = computeIntegrity(data);
  expect(verifyIntegrity(data, sri)).toBe(true);
  const tampered = new TextEncoder().encode("hello wardem");
  expect(verifyIntegrity(tampered, sri)).toBe(false);
});

test("verify accepts any of multiple space-separated integrities", () => {
  const sri512 = computeIntegrity(data, "sha512");
  const sri256 = computeIntegrity(data, "sha256");
  expect(verifyIntegrity(data, `${sri256} ${sri512}`)).toBe(true);
});

test("parseIntegrity", () => {
  expect(parseIntegrity("sha512-abc")).toEqual({ algo: "sha512", base64: "abc" });
  expect(parseIntegrity("nonsense")).toBeNull();
});

test("assertIntegrity throws on mismatch", () => {
  expect(() => assertIntegrity(data, "sha512-wrong")).toThrow(IntegrityError);
});
