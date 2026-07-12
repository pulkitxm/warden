import { Readable } from "node:stream";
import { Parser } from "tar";
import type { PackageMeta, TarballDiff, TarballFile } from "./types.js";
import { fetchBuffer } from "./utils/http.js";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_ENTRIES = 20_000;
const TEXT_EXT = /\.(js|cjs|mjs|jsx|ts|cts|mts|tsx|json|sh|bash|py|rb|txt|md|yml|yaml|map)$/i;

function isProbablyText(path: string): boolean {
  return TEXT_EXT.test(path) || /(^|\/)(package\.json|\.npmrc)$/i.test(path);
}

function normalizeEntryPath(p: string): string {
  return p.replace(/^package\//, "").replace(/^\.\//, "");
}

export async function fetchTarball(url: string, timeoutMs = 20_000): Promise<Buffer> {
  return fetchBuffer(url, { timeoutMs });
}

export function extractTarball(buffer: Buffer): Promise<TarballFile[]> {
  return new Promise((resolve, reject) => {
    const files: TarballFile[] = [];
    const parser = new Parser();
    let aborted = false;

    parser.on("entry", (entry) => {
      if (aborted) {
        entry.resume();
        return;
      }
      if (entry.type !== "File") {
        entry.resume();
        return;
      }
      if (files.length >= MAX_ENTRIES) {
        aborted = true;
        reject(new Error(`tarball has more than ${MAX_ENTRIES} entries`));
        entry.resume();
        return;
      }
      const path = normalizeEntryPath(entry.path);
      const chunks: Buffer[] = [];
      const wantText = isProbablyText(path);
      let size = 0;

      entry.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (wantText && size <= MAX_TEXT_BYTES) chunks.push(chunk);
      });
      entry.on("end", () => {
        const readable = wantText && size <= MAX_TEXT_BYTES;
        files.push({
          path,
          size,
          content: readable ? Buffer.concat(chunks).toString("utf8") : undefined,
          binary: !readable,
        });
      });
      entry.on("error", reject);
    });

    parser.on("end", () => {
      if (!aborted) resolve(files);
    });
    parser.on("error", reject);

    Readable.from(buffer).pipe(parser);
  });
}

export async function extractFromUrl(url: string): Promise<TarballFile[]> {
  return extractTarball(await fetchTarball(url));
}

function scriptsFromPackageJson(files: TarballFile[]): Record<string, string> {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg?.content) return {};
  try {
    const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

export interface DiffOptions {
  metaScripts?: Record<string, string>;
  prevMetaScripts?: Record<string, string>;
  isNewPackage?: boolean;
}

export function diffFileSets(
  current: TarballFile[],
  previous: TarballFile[] | undefined,
  opts: DiffOptions = {},
): TarballDiff {
  const isNewPackage = opts.isNewPackage ?? previous === undefined;
  const prevByPath = new Map((previous ?? []).map((f) => [f.path, f]));
  const curByPath = new Map(current.map((f) => [f.path, f]));

  const addedFiles: TarballFile[] = [];
  const changedFiles: TarballFile[] = [];
  for (const f of current) {
    const prev = prevByPath.get(f.path);
    if (!prev) {
      addedFiles.push(f);
    } else if (f.size !== prev.size || (f.content !== undefined && f.content !== prev.content)) {
      changedFiles.push(f);
    }
  }
  const removedPaths = (previous ?? []).filter((f) => !curByPath.has(f.path)).map((f) => f.path);

  const curScripts = { ...(opts.metaScripts ?? {}), ...scriptsFromPackageJson(current) };
  const prevScripts = {
    ...(opts.prevMetaScripts ?? {}),
    ...scriptsFromPackageJson(previous ?? []),
  };

  const addedScripts: Record<string, string> = {};
  const changedScripts: Record<string, string> = {};
  for (const [name, body] of Object.entries(curScripts)) {
    if (!(name in prevScripts)) addedScripts[name] = body;
    else if (prevScripts[name] !== body) changedScripts[name] = body;
  }

  return {
    isNewPackage,
    addedFiles,
    removedPaths,
    changedFiles,
    addedScripts,
    changedScripts,
    currentFiles: current,
  };
}

export function metadataOnlyDiff(meta: PackageMeta): TarballDiff {
  return diffFileSets([], undefined, {
    metaScripts: meta.scripts,
    prevMetaScripts: meta.previousScripts,
    isNewPackage: !meta.previousVersion,
  });
}

export async function diffPackage(meta: PackageMeta): Promise<TarballDiff> {
  if (!meta.tarballUrl) {
    throw new Error(`${meta.name}@${meta.version} has no tarball URL`);
  }
  const current = await extractFromUrl(meta.tarballUrl);
  let previous: TarballFile[] | undefined;
  if (meta.previousTarballUrl) {
    try {
      previous = await extractFromUrl(meta.previousTarballUrl);
    } catch {
      previous = undefined;
    }
  }

  return diffFileSets(current, previous, {
    metaScripts: meta.scripts,
    prevMetaScripts: meta.previousScripts,
    isNewPackage: !meta.previousVersion,
  });
}
