import { test, expect } from "bun:test";
import { diffVersions } from "../src/index.ts";
import type { TarEntry } from "@warden/tar";

const file = (path: string, text: string): TarEntry => ({ path, bytes: new TextEncoder().encode(text) });

test("new package: everything is added, all scripts added", () => {
  const cur = [file("package.json", JSON.stringify({ scripts: { postinstall: "node s.js" } })), file("index.js", "x")];
  const d = diffVersions(cur, undefined);
  expect(d.isNewPackage).toBe(true);
  expect(d.addedScripts).toEqual({ postinstall: "node s.js" });
  expect(d.scanFiles.map((f) => f.path).sort()).toEqual(["index.js", "package.json"]);
});

test("identical files are skipped; only changed files scanned", () => {
  const prev = [file("a.js", "same"), file("b.js", "old")];
  const cur = [file("a.js", "same"), file("b.js", "new")];
  const d = diffVersions(cur, prev);
  expect(d.scanFiles.map((f) => f.path)).toEqual(["b.js"]); // a.js identical -> skipped
});

test("malformed package.json is tolerated (no scripts parsed)", () => {
  const d = diffVersions([file("package.json", "{not json"), file("index.js", "x")], undefined);
  expect(d.isNewPackage).toBe(true);
  expect(d.addedScripts).toEqual({});
});

test("detects a newly added postinstall (axios-style scripts diff)", () => {
  const prev = [file("package.json", JSON.stringify({ scripts: { build: "tsc" } }))];
  const cur = [file("package.json", JSON.stringify({ scripts: { build: "tsc", postinstall: "node evil.js" } }))];
  const d = diffVersions(cur, prev);
  expect(d.addedScripts).toEqual({ postinstall: "node evil.js" });
  expect(d.changedScripts).toEqual({});
});
