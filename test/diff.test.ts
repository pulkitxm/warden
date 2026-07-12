import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { extractTarball } from "../src/diff.js";

describe("extractTarball", () => {
  let dir: string;
  let tarball: Buffer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "warden-tar-"));
    await mkdir(join(dir, "package", "lib"), { recursive: true });
    await writeFile(
      join(dir, "package", "package.json"),
      JSON.stringify({ name: "demo", version: "1.0.0", scripts: { postinstall: "node x.js" } }),
    );
    await writeFile(join(dir, "package", "index.js"), "module.exports = 1;");
    await writeFile(join(dir, "package", "lib", "big.js"), "x".repeat(3000));

    const tmpTar = join(dir, "out.tgz");
    await create({ gzip: true, cwd: dir, file: tmpTar }, ["package"]);
    tarball = await readFile(tmpTar);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts files with package/ prefix stripped and text content attached", async () => {
    const files = await extractTarball(tarball);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["index.js", "lib/big.js", "package.json"]);

    const pkg = files.find((f) => f.path === "package.json");
    expect(pkg?.content).toContain('"postinstall"');

    const big = files.find((f) => f.path === "lib/big.js");
    expect(big?.size).toBe(3000);
    expect(big?.content).toBeDefined();
  });
});
