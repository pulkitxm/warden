/**
 * Diff two extracted package versions.
 *
 * The efficiency win: build a path -> SRI map for each version and skip files
 * whose hash is identical. Only added/changed files are scanned, and the
 * package.json `scripts` block is diffed field-by-field so a newly added
 * lifecycle hook is caught precisely. Produces the scan/script pieces of the
 * heuristics AnalysisInput.
 */

import type { TarEntry } from "@warden/tar";
import { computeIntegrity } from "@warden/sri";

const TEXT_RE = /\.(js|cjs|mjs|jsx|ts|cts|mts|tsx|json|sh|bash)$/i;
const MAX_SCAN_BYTES = 512 * 1024;

export interface DiffResult {
  isNewPackage: boolean;
  addedScripts: Record<string, string>;
  changedScripts: Record<string, string>;
  scanFiles: Array<{ path: string; text?: string }>;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function scriptsFrom(entries: TarEntry[]): Record<string, string> {
  const pkg = entries.find((e) => e.path === "package.json");
  if (!pkg) return {};
  try {
    return (JSON.parse(decode(pkg.bytes)) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return {};
  }
}

function textFile(e: TarEntry): { path: string; text?: string } {
  const readable = TEXT_RE.test(e.path) && e.bytes.length <= MAX_SCAN_BYTES;
  return { path: e.path, text: readable ? decode(e.bytes) : undefined };
}

/**
 * @param current  extracted entries of the target version
 * @param previous extracted entries of the last-trusted version, or undefined
 *                 for a brand-new package
 */
export function diffVersions(
  current: TarEntry[],
  previous: TarEntry[] | undefined,
  fallback: { metaScripts?: Record<string, string>; prevMetaScripts?: Record<string, string> } = {},
): DiffResult {
  const isNewPackage = previous === undefined;
  const prevHash = new Map(previous?.map((e) => [e.path, computeIntegrity(e.bytes)]) ?? []);

  // Added or changed files only.
  const scanEntries = current.filter((e) => {
    const before = prevHash.get(e.path);
    return before === undefined || before !== computeIntegrity(e.bytes);
  });
  const scanFiles = scanEntries.filter((e) => TEXT_RE.test(e.path)).map(textFile);

  // Scripts diff: prefer tarball package.json, fall back to registry metadata.
  const cur = { ...(fallback.metaScripts ?? {}), ...scriptsFrom(current) };
  const prev = isNewPackage ? {} : { ...(fallback.prevMetaScripts ?? {}), ...scriptsFrom(previous ?? []) };
  const addedScripts: Record<string, string> = {};
  const changedScripts: Record<string, string> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (!(k in prev)) addedScripts[k] = v;
    else if (prev[k] !== v) changedScripts[k] = v;
  }

  return { isNewPackage, addedScripts, changedScripts, scanFiles };
}
