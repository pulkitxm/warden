import { expect, test } from "bun:test";
import { makeTgz } from "../fixtures/registry/tarWriter.ts";
import { entryText, readTar, readTgz } from "../src/tar.ts";

const tgz = makeTgz([
  {
    path: "package.json",
    content: JSON.stringify({
      name: "demo",
      version: "1.0.0",
      scripts: { postinstall: "node x.js" },
    }),
  },
  { path: "index.js", content: "module.exports = 1;" },
  { path: "lib/big.js", content: "x".repeat(3000) },
]);

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

test("GNU long-name (typeflag L) entries resolve to the full path", () => {
  const longDir = "deeply-nested-directory-with-a-very-long-name-segment";
  const longFile = "another-quite-long-file-name-that-pushes-past-the-ustar-limit.js";
  const entries = readTgz(
    makeTgz([{ path: `${longDir}/${longFile}`, content: "module.exports=42;" }]),
  );
  const entry = entries.find((e) => e.path === `${longDir}/${longFile}`)!;
  expect(entryText(entry)).toBe("module.exports=42;");
});

test("ignores non-file tar entries", () => {
  const tar = Bun.gunzipSync(tgz);
  tar[156] = "5".charCodeAt(0);
  expect(readTar(tar).map((entry) => entry.path)).not.toContain("package.json");
});

test("refuses a tarball whose gzip ISIZE declares a decompression bomb", () => {
  const bomb = Uint8Array.from(tgz);
  bomb.set([0xff, 0xff, 0xff, 0xff], bomb.length - 4);
  expect(() => readTgz(bomb)).toThrow(/unpacked size/);
});

test("refuses a multi-member tarball that inflates past the cap", () => {
  const big = Bun.gzipSync(new Uint8Array(513 * 1024 * 1024), { level: 1 });
  const tiny = Bun.gzipSync(new TextEncoder().encode("x"));
  const multi = new Uint8Array(big.length + tiny.length);
  multi.set(big, 0);
  multi.set(tiny, big.length);
  expect(() => readTgz(multi)).toThrow(/unpacks to/);
});
