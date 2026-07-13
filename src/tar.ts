const BLOCK = 512;

export interface TarEntry {
  path: string;
  bytes: Uint8Array;
}

function readString(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(off, end));
}

function readOctal(buf: Uint8Array, off: number, len: number): number {
  const s = readString(buf, off, len).trim().replace(/\0.*$/, "");
  if (!s) return 0;
  return parseInt(s, 8) || 0;
}

function stripPackagePrefix(name: string): string {
  return name.replace(/^\.?\//, "").replace(/^package\//, "");
}

export function readTar(tarBytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;

  while (offset + BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const rawName = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const prefix = readString(header, 345, 155);

    offset += BLOCK;
    const dataStart = offset;
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    offset += padded;

    if (typeflag === "L") {
      longName = readString(tarBytes, dataStart, size).replace(/\0+$/, "");
      continue;
    }

    if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      const fullName = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      longName = null;
      const path = stripPackagePrefix(fullName);
      if (!path) continue;
      entries.push({ path, bytes: tarBytes.subarray(dataStart, dataStart + size) });
    } else {
      longName = null;
    }
  }
  return entries;
}

const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

function gzipIsize(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0;
  const n = bytes.length;
  return (
    (bytes[n - 4]! | (bytes[n - 3]! << 8) | (bytes[n - 2]! << 16) | (bytes[n - 1]! << 24)) >>> 0
  );
}

export function readTgz(tgzBytes: Uint8Array<ArrayBuffer>): TarEntry[] {
  if (gzipIsize(tgzBytes) > MAX_UNPACKED_BYTES) {
    throw new Error(`tarball declares an unpacked size over the ${MAX_UNPACKED_BYTES}-byte cap`);
  }
  const raw = Bun.gunzipSync(tgzBytes);
  if (raw.length > MAX_UNPACKED_BYTES) {
    throw new Error(
      `tarball unpacks to ${raw.length} bytes, over the ${MAX_UNPACKED_BYTES}-byte cap`,
    );
  }
  return readTar(raw);
}

export function entryText(entry: TarEntry): string {
  return new TextDecoder().decode(entry.bytes);
}
