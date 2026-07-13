/**
 * Minimal in-memory ustar + gzip writer, for building fixture tarballs without
 * shelling to `tar` or touching disk. Produces npm-style `package/`-prefixed
 * gzipped tarballs that src/tar.ts reads back.
 */

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}

function header(path: string, size: number, typeflag = "0"): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();
  const write = (s: string, off: number, len: number) => h.set(enc.encode(s).subarray(0, len), off);
  write(path, 0, 100);
  write("0000644", 0o0, 0); // no-op placeholder to keep shape obvious
  write("0000644\0", 100, 8); // mode
  write("0000000\0", 108, 8); // uid
  write("0000000\0", 116, 8); // gid
  write(octal(size, 12), 124, 12); // size
  write(octal(0, 12), 136, 12); // mtime
  h[156] = typeflag.charCodeAt(0);
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  // checksum: sum of all bytes with the checksum field treated as spaces
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (const b of h) sum += b;
  write(octal(sum, 7).slice(0, 7), 148, 7);
  h[155] = 0x20;
  return h;
}

export interface FixtureFile {
  path: string; // relative to package root, e.g. "package.json"
  content: string;
}

/** Build a gzipped tarball from files (each gets the `package/` prefix). */
export function makeTgz(files: FixtureFile[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const data = enc.encode(f.content);
    const path = `package/${f.path}`;
    if (enc.encode(path).length > 100) {
      const longPath = enc.encode(`${path}\0`);
      blocks.push(header("././@LongLink", longPath.length, "L"));
      const paddedPath = new Uint8Array(Math.ceil(longPath.length / 512) * 512);
      paddedPath.set(longPath);
      blocks.push(paddedPath);
    }
    blocks.push(header(path, data.length));
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end of archive
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    tar.set(b, off);
    off += b.length;
  }
  return Uint8Array.from(Bun.gzipSync(tar));
}
