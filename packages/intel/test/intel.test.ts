import { test, expect } from "bun:test";
import { Blocklist, defaultBlocklist, defaultHallucinated } from "../src/index.ts";

test("curated hallucinated names are recognized", () => {
  expect(defaultHallucinated.has("react-codeshift")).toBe(true);
  expect(defaultHallucinated.has("react")).toBe(false);
});

test("matches a known compromised version, not a clean one", () => {
  expect(defaultBlocklist.match("chalk", "5.6.1")?.id).toBe("MAL-CHALK-2025");
  expect(defaultBlocklist.match("chalk", "5.3.0")).toBeNull(); // clean version
  expect(defaultBlocklist.match("axios", "1.14.1")?.id).toBe("MAL-AXIOS-2026");
});

test("whole-package entry (no versions) matches any version", () => {
  const bl = new Blocklist([{ id: "MAL-X", name: "evil-pkg" }]);
  expect(bl.match("evil-pkg", "9.9.9")?.id).toBe("MAL-X");
  expect(bl.match("evil-pkg")?.id).toBe("MAL-X");
});

test("unknown package is not blocked", () => {
  expect(defaultBlocklist.match("lodash", "4.17.21")).toBeNull();
});

test("size counts every entry across names", () => {
  const bl = new Blocklist([
    { id: "A", name: "p" },
    { id: "B", name: "p", versions: ["1.0.0"] },
    { id: "C", name: "q" },
  ]);
  expect(bl.size()).toBe(3);
  expect(defaultBlocklist.size()).toBeGreaterThan(0);
});
