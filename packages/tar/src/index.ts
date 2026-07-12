/**
 * Minimal ustar reader for npm tarballs.
 *
 * npm publishes gzipped tarballs (`.tgz`) whose entries are all prefixed with
 * `package/`. We gunzip with `Bun.gunzipSync` then walk 512-byte ustar blocks.
 * We only need regular files; directories, symlinks, and metadata blocks are
 * skipped. GNU long names ('L' typeflag) are handled because some packages hit
 * the 100-char name limit. This replaces a full `tar` dependency.
 */

const BLOCK = 512;

export interface TarEntry {
  /** Path with the leading `package/` stripped. */
  path: string;
  bytes: Uint8Array;
}

function readString(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(off, end));
}

/** Parse an octal numeric field (size, etc.); tolerates spaces/nuls. */
function readOctal(buf: Uint8Array, off: number, len: number): number {
  const s = readString(buf, off, len).trim().replace(/\0.*$/, "");
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

function stripPackagePrefix(name: string): string {
  return name.replace(/^\.?\//, "").replace(/^package\//, "");
}

/** Extract regular files from an uncompressed tar buffer. */
export function readTar(tarBytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;

  while (offset + BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark end of archive; a single zero block ends parsing.
    if (header.every((b) => b === 0)) break;

    const rawName = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const prefix = readString(header, 345, 155); // ustar path prefix

    offset += BLOCK;
    const dataStart = offset;
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    offset += padded;

    if (typeflag === "L") {
      // GNU long name: the entry's data is the real name for the NEXT header.
      longName = readString(tarBytes, dataStart, size).replace(/\0+$/, "");
      continue;
    }

    // Regular file: typeflag '0' or NUL (old tar).
    if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      const fullName = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      longName = null;
      const path = stripPackagePrefix(fullName);
      if (!path) continue;
      entries.push({ path, bytes: tarBytes.subarray(dataStart, dataStart + size) });
    } else {
      longName = null; // dir/symlink/etc.
    }
  }
  return entries;
}

/** Gunzip a `.tgz` and read its files. Input must be ArrayBuffer-backed (as
 * produced by fetch().arrayBuffer() or fs reads), which Bun.gunzipSync requires. */
export function readTgz(tgzBytes: Uint8Array<ArrayBuffer>): TarEntry[] {
  return readTar(Bun.gunzipSync(tgzBytes));
}

/** Convenience: decode an entry's bytes as UTF-8 text. */
export function entryText(entry: TarEntry): string {
  return new TextDecoder().decode(entry.bytes);
}
