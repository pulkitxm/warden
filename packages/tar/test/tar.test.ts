import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { readTgz, entryText } from "../src/index.ts";

let dir: string;
let tgz: Uint8Array;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "warden-tar-"));
  await mkdir(join(dir, "package", "lib"), { recursive: true });
  await writeFile(
    join(dir, "package", "package.json"),
    JSON.stringify({ name: "demo", version: "1.0.0", scripts: { postinstall: "node x.js" } }),
  );
  await writeFile(join(dir, "package", "index.js"), "module.exports = 1;");
  await writeFile(join(dir, "package", "lib", "big.js"), "x".repeat(3000));
  // Real npm-style tarball: package/ prefixed, gzipped, via system tar.
  await $`tar -czf ${join(dir, "out.tgz")} -C ${dir} package`.quiet();
  tgz = new Uint8Array(await readFile(join(dir, "out.tgz")));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("reads files with package/ prefix stripped", () => {
  const entries = readTgz(tgz);
  const paths = entries.map((e) => e.path).sort();
  expect(paths).toEqual(["index.js", "lib/big.js", "package.json"]);
});

test("preserves file content and size", () => {
  const entries = readTgz(tgz);
  const pkg = entries.find((e) => e.path === "package.json")!;
  expect(entryText(pkg)).toContain('"postinstall"');
  const big = entries.find((e) => e.path === "lib/big.js")!;
  expect(big.bytes.length).toBe(3000);
});
