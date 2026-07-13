import { computeIntegrity } from "./integrity.ts";
import type { TarEntry } from "./tar.ts";

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

export function diffVersions(
  current: TarEntry[],
  previous: TarEntry[] | undefined,
  fallback: { metaScripts?: Record<string, string>; prevMetaScripts?: Record<string, string> } = {},
): DiffResult {
  const isNewPackage = previous === undefined;
  const prevHash = new Map(previous?.map((e) => [e.path, computeIntegrity(e.bytes)]) ?? []);

  const scanEntries = current.filter((e) => {
    const before = prevHash.get(e.path);
    return before === undefined || before !== computeIntegrity(e.bytes);
  });
  const scanFiles = scanEntries.filter((e) => TEXT_RE.test(e.path)).map(textFile);

  const cur = { ...(fallback.metaScripts ?? {}), ...scriptsFrom(current) };
  const prev = isNewPackage
    ? {}
    : { ...(fallback.prevMetaScripts ?? {}), ...scriptsFrom(previous ?? []) };
  const addedScripts: Record<string, string> = {};
  const changedScripts: Record<string, string> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (!(k in prev)) addedScripts[k] = v;
    else if (prev[k] !== v) changedScripts[k] = v;
  }

  return { isNewPackage, addedScripts, changedScripts, scanFiles };
}
