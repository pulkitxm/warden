import { expect, test } from "bun:test";
import {
  ANALYZED_KINDS,
  type ArtifactKind,
  buildInventory,
  classifyArtifact,
  inventoryNotes,
} from "../../src/inventory/artifacts.ts";
import type { TarEntry } from "../../src/tar.ts";

const bytes = (values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const entry = (path: string, content: Uint8Array): TarEntry => ({ path, bytes: content });

const MAGIC_CASES: Array<[string, number[], ArtifactKind]> = [
  ["a WebAssembly module", [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00], "wasm"],
  ["an ELF binary", [0x7f, 0x45, 0x4c, 0x46, 0x02], "native"],
  ["a Windows PE binary", [0x4d, 0x5a, 0x90, 0x00], "native"],
  ["a 64-bit Mach-O binary", [0xfe, 0xed, 0xfa, 0xcf, 0x0c], "native"],
  ["a reversed Mach-O binary", [0xcf, 0xfa, 0xed, 0xfe, 0x0c], "native"],
  ["a universal Mach-O binary", [0xca, 0xfe, 0xba, 0xbe, 0x00], "native"],
  ["a zip archive", [0x50, 0x4b, 0x03, 0x04, 0x14], "archive"],
  ["a gzip archive", [0x1f, 0x8b, 0x08, 0x00], "archive"],
  ["a bzip2 archive", [0x42, 0x5a, 0x68, 0x39], "archive"],
  ["an xz archive", [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], "archive"],
  ["a zstd archive", [0x28, 0xb5, 0x2f, 0xfd, 0x00], "archive"],
  ["a PNG image", [0x89, 0x50, 0x4e, 0x47, 0x0d], "image"],
  ["a JPEG image", [0xff, 0xd8, 0xff, 0xe0], "image"],
];

for (const [label, magic, kind] of MAGIC_CASES) {
  test(`${label} is identified by its magic bytes, not its name`, () => {
    const artifact = classifyArtifact("index.js", bytes(magic));
    expect(artifact.kind).toBe(kind);
    expect(artifact.detectedBy).toBe("magic");
  });
}

test("a native binary named index.js is still a native binary", () => {
  const artifact = classifyArtifact("lib/index.js", bytes([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
  expect(artifact.kind).toBe("native");
  expect(artifact.analyzed).toBe(false);
  expect(artifact.note).toContain("ELF");
});

test("a file too short to hold a magic number falls through instead of matching", () => {
  expect(classifyArtifact("tiny.bin", bytes([0x7f])).detectedBy).not.toBe("magic");
});

const SHEBANG_CASES: Array<[string, string, ArtifactKind]> = [
  ["bash", "#!/bin/bash\necho hi\n", "shell"],
  ["sh", "#!/bin/sh\necho hi\n", "shell"],
  ["zsh", "#!/usr/bin/env zsh\n", "shell"],
  ["pwsh", "#!/usr/bin/env pwsh\n", "powershell"],
  ["python", "#!/usr/bin/env python3\nprint(1)\n", "python"],
  ["ruby", "#!/usr/bin/env ruby\n", "ruby"],
  ["perl", "#!/usr/bin/perl\n", "perl"],
  ["node", "#!/usr/bin/env node\n", "javascript"],
];

for (const [label, body, kind] of SHEBANG_CASES) {
  test(`an extensionless file with a ${label} shebang is classified by its interpreter`, () => {
    const artifact = classifyArtifact("bin/tool", text(body));
    expect(artifact.kind).toBe(kind);
    expect(artifact.detectedBy).toBe("shebang");
  });
}

const EXTENSION_CASES: Array<[string, ArtifactKind]> = [
  ["src/index.js", "javascript"],
  ["src/index.mjs", "javascript"],
  ["src/index.cjs", "javascript"],
  ["src/index.jsx", "javascript"],
  ["src/index.ts", "typescript"],
  ["src/index.tsx", "typescript"],
  ["src/index.d.ts", "declaration"],
  ["package.json", "json"],
  ["build/addon.node", "native"],
  ["build/lib.so", "native"],
  ["build/lib.dylib", "native"],
  ["build/lib.dll", "native"],
  ["prebuilds/module.wasm", "wasm"],
  ["vendor/bundle.tgz", "archive"],
  ["scripts/setup.sh", "shell"],
  ["scripts/setup.ps1", "powershell"],
  ["tools/gen.py", "python"],
  ["README.md", "text"],
  ["logo.svg", "image"],
];

for (const [path, kind] of EXTENSION_CASES) {
  test(`${path} is classified as ${kind}`, () => {
    expect(classifyArtifact(path, text("plain content")).kind).toBe(kind);
  });
}

test("a declaration file is not mistaken for ordinary typescript", () => {
  expect(classifyArtifact("types/index.d.ts", text("export {}")).kind).toBe("declaration");
  expect(classifyArtifact("types/index.d.mts", text("export {}")).kind).toBe("declaration");
});

test("magic bytes beat the extension when the two disagree", () => {
  const artifact = classifyArtifact("harmless.json", bytes([0x00, 0x61, 0x73, 0x6d, 0x01]));
  expect(artifact.kind).toBe("wasm");
});

test("a shebang beats the extension, because the interpreter is what actually runs", () => {
  expect(classifyArtifact("thing.txt", text("#!/bin/bash\nrm -rf /\n")).kind).toBe("shell");
});

test("an unrecognised file with null bytes is reported as binary rather than as text", () => {
  const artifact = classifyArtifact("blob.dat", bytes([0x41, 0x42, 0x00, 0x43]));
  expect(artifact.kind).toBe("binary");
  expect(artifact.detectedBy).toBe("content");
  expect(artifact.analyzed).toBe(false);
});

test("an unrecognised file of ordinary text is unknown, not binary", () => {
  expect(classifyArtifact("LICENSE-ISC", text("Permission is granted...")).kind).toBe("unknown");
});

test("an empty file is not guessed at", () => {
  const artifact = classifyArtifact("empty", new Uint8Array());
  expect(artifact.kind).toBe("unknown");
  expect(artifact.bytes).toBe(0);
});

test("control-character density marks a file binary even without a null byte", () => {
  expect(classifyArtifact("weird", bytes(Array.from({ length: 64 }, () => 0x01))).kind).toBe(
    "binary",
  );
});

test("only source-shaped kinds are counted as analyzed", () => {
  expect([...ANALYZED_KINDS].sort()).toEqual([
    "declaration",
    "image",
    "javascript",
    "json",
    "text",
    "typescript",
  ]);
  for (const kind of ["native", "wasm", "archive", "shell", "python", "binary"] as ArtifactKind[]) {
    expect(`${kind} analyzed: ${ANALYZED_KINDS.has(kind)}`).toBe(`${kind} analyzed: false`);
  }
});

test("an inventory reports coverage rather than implying the whole tarball was read", () => {
  const inventory = buildInventory([
    entry("index.js", text("module.exports = 1;")),
    entry("package.json", text("{}")),
    entry("build/addon.node", bytes([0x7f, 0x45, 0x4c, 0x46])),
    entry("scripts/setup.sh", text("#!/bin/sh\n")),
  ]);
  expect(inventory.total).toBe(4);
  expect(inventory.analyzed).toBe(2);
  expect(inventory.unanalyzed).toBe(2);
  expect(inventory.coverage).toBe(0.5);
});

test("an all-source tarball reports complete coverage", () => {
  const inventory = buildInventory([
    entry("index.js", text("1")),
    entry("package.json", text("{}")),
  ]);
  expect(inventory.coverage).toBe(1);
  expect(inventory.notable).toEqual([]);
});

test("an empty tarball is complete rather than zero coverage", () => {
  expect(buildInventory([]).coverage).toBe(1);
});

test("notable artifacts are listed largest first, because size is what hides things", () => {
  const inventory = buildInventory([
    entry("small.node", bytes([0x7f, 0x45, 0x4c, 0x46])),
    entry("big.node", bytes([0x7f, 0x45, 0x4c, 0x46, ...Array.from({ length: 500 }, () => 0)])),
    entry("index.js", text("1")),
  ]);
  expect(inventory.notable.map((artifact) => artifact.path)).toEqual(["big.node", "small.node"]);
});

test("kind counts add up to the total", () => {
  const inventory = buildInventory([
    entry("a.js", text("1")),
    entry("b.js", text("2")),
    entry("c.wasm", bytes([0x00, 0x61, 0x73, 0x6d])),
  ]);
  expect(Object.values(inventory.byKind).reduce((sum, value) => sum + value, 0)).toBe(
    inventory.total,
  );
  expect(inventory.byKind.javascript).toBe(2);
});

test("the notes state plainly what was not analyzed", () => {
  const notes = inventoryNotes(
    buildInventory([
      entry("addon.node", bytes([0x7f, 0x45, 0x4c, 0x46])),
      entry("mod.wasm", bytes([0x00, 0x61, 0x73, 0x6d])),
      entry("nested.tgz", bytes([0x1f, 0x8b])),
      entry("setup.sh", text("#!/bin/sh\n")),
      entry("gen.py", text("#!/usr/bin/env python3\n")),
      entry("blob.dat", bytes([0x00, 0x01, 0x02])),
    ]),
  );
  const joined = notes.join(" | ");
  expect(joined).toContain("native binaries");
  expect(joined).toContain("WebAssembly");
  expect(joined).toContain("nested archives");
  expect(joined).toContain("outside the AST analyzer");
  expect(joined).toContain("unrecognised format");
});

test("a clean source-only package produces no notes at all", () => {
  expect(inventoryNotes(buildInventory([entry("index.js", text("1"))]))).toEqual([]);
});

test("the note counts match the inventory counts", () => {
  const inventory = buildInventory([
    entry("a.node", bytes([0x7f, 0x45, 0x4c, 0x46])),
    entry("b.node", bytes([0x7f, 0x45, 0x4c, 0x46])),
  ]);
  expect(inventoryNotes(inventory)[0]).toContain("2 native binaries");
});

test("a package that hides a binary as a data file is still counted", () => {
  const inventory = buildInventory([entry("data/model.json", bytes([0x4d, 0x5a, 0x90]))]);
  expect(inventory.byKind.native).toBe(1);
  expect(inventory.coverage).toBe(0);
});
