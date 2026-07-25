import type { TarEntry } from "../tar.ts";

export type ArtifactKind =
  | "javascript"
  | "typescript"
  | "declaration"
  | "json"
  | "wasm"
  | "native"
  | "archive"
  | "shell"
  | "powershell"
  | "python"
  | "ruby"
  | "perl"
  | "binary"
  | "image"
  | "text"
  | "unknown";

export interface Artifact {
  path: string;
  kind: ArtifactKind;
  bytes: number;
  detectedBy: "magic" | "extension" | "shebang" | "content";
  analyzed: boolean;
  note?: string;
}

export interface ArtifactInventory {
  schema_version: 1;
  total: number;
  analyzed: number;
  unanalyzed: number;
  byKind: Record<string, number>;
  notable: Artifact[];
  coverage: number;
}

const MAGIC: Array<{ bytes: number[]; kind: ArtifactKind; note: string }> = [
  { bytes: [0x00, 0x61, 0x73, 0x6d], kind: "wasm", note: "WebAssembly module" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: "native", note: "ELF executable or shared object" },
  { bytes: [0x4d, 0x5a], kind: "native", note: "Windows PE executable" },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], kind: "native", note: "Mach-O 32-bit" },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], kind: "native", note: "Mach-O 64-bit" },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], kind: "native", note: "Mach-O 64-bit, reversed" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], kind: "native", note: "Mach-O universal binary" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: "archive", note: "zip archive" },
  { bytes: [0x1f, 0x8b], kind: "archive", note: "gzip archive" },
  { bytes: [0x42, 0x5a, 0x68], kind: "archive", note: "bzip2 archive" },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], kind: "archive", note: "xz archive" },
  { bytes: [0x28, 0xb5, 0x2f, 0xfd], kind: "archive", note: "zstd archive" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], kind: "image", note: "PNG image" },
  { bytes: [0xff, 0xd8, 0xff], kind: "image", note: "JPEG image" },
];

const EXTENSIONS: Array<{ pattern: RegExp; kind: ArtifactKind }> = [
  { pattern: /\.d\.[cm]?ts$/i, kind: "declaration" },
  { pattern: /\.[cm]?tsx?$/i, kind: "typescript" },
  { pattern: /\.[cm]?jsx?$/i, kind: "javascript" },
  { pattern: /\.json[5c]?$/i, kind: "json" },
  { pattern: /\.wasm$/i, kind: "wasm" },
  { pattern: /\.(node|so|dylib|dll|a|lib)$/i, kind: "native" },
  { pattern: /\.(tgz|tar|gz|zip|xz|bz2|zst|7z|rar)$/i, kind: "archive" },
  { pattern: /\.(sh|bash|zsh|fish)$/i, kind: "shell" },
  { pattern: /\.(ps1|psm1|bat|cmd)$/i, kind: "powershell" },
  { pattern: /\.py[cwo]?$/i, kind: "python" },
  { pattern: /\.rb$/i, kind: "ruby" },
  { pattern: /\.(pl|pm)$/i, kind: "perl" },
  { pattern: /\.(png|jpe?g|gif|webp|ico|svg)$/i, kind: "image" },
  { pattern: /\.(md|txt|yml|yaml|toml|html?|css|map|LICENSE)$/i, kind: "text" },
];

const SHEBANG: Array<{ pattern: RegExp; kind: ArtifactKind }> = [
  { pattern: /^#!.*\b(bash|sh|zsh|dash)\b/, kind: "shell" },
  { pattern: /^#!.*\bpwsh\b/, kind: "powershell" },
  { pattern: /^#!.*\bpython[\d.]*\b/, kind: "python" },
  { pattern: /^#!.*\bruby\b/, kind: "ruby" },
  { pattern: /^#!.*\bperl\b/, kind: "perl" },
  { pattern: /^#!.*\bnode\b/, kind: "javascript" },
];

export const ANALYZED_KINDS = new Set<ArtifactKind>([
  "javascript",
  "typescript",
  "declaration",
  "json",
  "text",
  "image",
]);

function matchesMagic(bytes: Uint8Array): { kind: ArtifactKind; note: string } | null {
  for (const entry of MAGIC) {
    if (bytes.length < entry.bytes.length) continue;
    if (entry.bytes.every((value, index) => bytes[index] === value))
      return { kind: entry.kind, note: entry.note };
  }
  return null;
}

function looksBinary(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, Math.min(bytes.length, 512));
  if (!window.length) return false;
  let suspicious = 0;
  for (const byte of window) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / window.length > 0.1;
}

export function classifyArtifact(path: string, bytes: Uint8Array): Artifact {
  const magic = matchesMagic(bytes);
  if (magic) {
    return {
      path,
      kind: magic.kind,
      bytes: bytes.length,
      detectedBy: "magic",
      analyzed: ANALYZED_KINDS.has(magic.kind),
      note: magic.note,
    };
  }

  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 128)));
  for (const entry of SHEBANG) {
    if (entry.pattern.test(head)) {
      return {
        path,
        kind: entry.kind,
        bytes: bytes.length,
        detectedBy: "shebang",
        analyzed: ANALYZED_KINDS.has(entry.kind),
        note: `interpreter declared by shebang`,
      };
    }
  }

  for (const entry of EXTENSIONS) {
    if (entry.pattern.test(path)) {
      return {
        path,
        kind: entry.kind,
        bytes: bytes.length,
        detectedBy: "extension",
        analyzed: ANALYZED_KINDS.has(entry.kind),
      };
    }
  }

  if (looksBinary(bytes)) {
    return {
      path,
      kind: "binary",
      bytes: bytes.length,
      detectedBy: "content",
      analyzed: false,
      note: "binary content of an unrecognised format",
    };
  }

  return { path, kind: "unknown", bytes: bytes.length, detectedBy: "content", analyzed: false };
}

const NOTABLE = new Set<ArtifactKind>([
  "native",
  "wasm",
  "archive",
  "shell",
  "powershell",
  "python",
  "ruby",
  "perl",
  "binary",
]);

export function buildInventory(entries: TarEntry[]): ArtifactInventory {
  const artifacts = entries.map((entry) => classifyArtifact(entry.path, entry.bytes));
  const byKind: Record<string, number> = {};
  for (const artifact of artifacts) byKind[artifact.kind] = (byKind[artifact.kind] ?? 0) + 1;

  const analyzed = artifacts.filter((artifact) => artifact.analyzed).length;
  const notable = artifacts
    .filter((artifact) => NOTABLE.has(artifact.kind))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    schema_version: 1,
    total: artifacts.length,
    analyzed,
    unanalyzed: artifacts.length - analyzed,
    byKind,
    notable,
    coverage: artifacts.length ? analyzed / artifacts.length : 1,
  };
}

export function inventoryNotes(inventory: ArtifactInventory): string[] {
  const notes: string[] = [];
  const count = (kind: ArtifactKind) => inventory.byKind[kind] ?? 0;

  if (count("native"))
    notes.push(
      `${count("native")} native binaries are present and were not analyzed; static analysis reads source, not compiled code`,
    );
  if (count("wasm"))
    notes.push(`${count("wasm")} WebAssembly modules are present and were not analyzed`);
  if (count("archive"))
    notes.push(
      `${count("archive")} nested archives are present; their contents were not unpacked or analyzed`,
    );
  const scripts =
    count("shell") + count("powershell") + count("python") + count("ruby") + count("perl");
  if (scripts)
    notes.push(
      `${scripts} scripts in languages outside the AST analyzer are present in the tarball`,
    );
  if (count("binary"))
    notes.push(`${count("binary")} files hold binary content of an unrecognised format`);
  return notes;
}
