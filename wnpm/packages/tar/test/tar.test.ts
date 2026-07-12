import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { readTgz, entryText } from "../src/index.ts";

let dir: string;
let tgz: Uint8Array<ArrayBuffer>;

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
  tgz = Uint8Array.from(await readFile(join(dir, "out.tgz")));
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

test("GNU long-name (typeflag L) entries resolve to the full path", async () => {
  const d2 = await mkdtemp(join(tmpdir(), "warden-tar-long-"));
  const longDir = "deeply-nested-directory-with-a-very-long-name-segment";
  const longFile = "another-quite-long-file-name-that-pushes-past-the-ustar-limit.js";
  await mkdir(join(d2, "package", longDir), { recursive: true });
  await writeFile(join(d2, "package", longDir, longFile), "module.exports=42;");
  await $`tar --format=gnu -czf ${join(d2, "out.tgz")} -C ${d2} package`.quiet();
  const entries = readTgz(Uint8Array.from(await readFile(join(d2, "out.tgz"))));
  const entry = entries.find((e) => e.path === `${longDir}/${longFile}`)!;
  expect(entryText(entry)).toBe("module.exports=42;");
  await rm(d2, { recursive: true, force: true });
});

test("refuses a tarball whose gzip ISIZE declares a decompression bomb", () => {
  const bomb = Uint8Array.from(tgz); // valid gzip with a forged uncompressed-size trailer
  bomb.set([0xff, 0xff, 0xff, 0xff], bomb.length - 4);
  expect(() => readTgz(bomb)).toThrow(/unpacked size/);
});

test("refuses a multi-member tarball that inflates past the cap", () => {
  // Two concatenated gzip members: the trailer ISIZE only describes the last
  // (tiny) member, so this bomb is only caught by the post-inflate check.
  const big = Bun.gzipSync(new Uint8Array(513 * 1024 * 1024), { level: 1 });
  const tiny = Bun.gzipSync(new TextEncoder().encode("x"));
  const multi = new Uint8Array(big.length + tiny.length);
  multi.set(big, 0);
  multi.set(tiny, big.length);
  expect(() => readTgz(multi)).toThrow(/unpacks to/);
});
