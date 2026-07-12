import { gzipSync } from "node:zlib";

function octal(n: number, len: number): string {
  return `${n.toString(8).padStart(len - 1, "0")}\0`;
}

function header(path: string, size: number, typeflag = "0"): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();
  const write = (s: string, off: number, len: number) => h.set(enc.encode(s).subarray(0, len), off);
  write(path, 0, 100);
  write("0000644\0", 100, 8);
  write("0000000\0", 108, 8);
  write("0000000\0", 116, 8);
  write(octal(size, 12), 124, 12);
  write(octal(0, 12), 136, 12);
  h[156] = typeflag.charCodeAt(0);
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (const b of h) sum += b;
  write(octal(sum, 7).slice(0, 7), 148, 7);
  h[155] = 0x20;
  return h;
}

export interface TarEntry {
  path: string;
  content: string;
  type?: "file" | "dir";
}

export function makeTgz(files: TarEntry[]): Buffer {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const data = enc.encode(f.content);
    const h = header(
      `package/${f.path}`,
      f.type === "dir" ? 0 : data.length,
      f.type === "dir" ? "5" : "0",
    );
    blocks.push(h);
    if (f.type !== "dir" && data.length) {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
      padded.set(data);
      blocks.push(padded);
    }
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    tar.set(b, off);
    off += b.length;
  }
  return gzipSync(Buffer.from(tar));
}
