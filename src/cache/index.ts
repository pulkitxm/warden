import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Verdict } from "../types.js";

export interface VerdictCache {
  get(key: string): Promise<Verdict | undefined>;
  set(key: string, verdict: Verdict): Promise<void>;
  size(): Promise<number>;
}

export function cacheKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function keyToFilename(key: string): string {
  return `${createHash("sha1").update(key).digest("hex")}.json`;
}

export class FileVerdictCache implements VerdictCache {
  private dir: string;
  private ready: Promise<void>;

  constructor(dir = process.env.WARDEN_CACHE_DIR ?? join(homedir(), ".warden-cache")) {
    this.dir = dir;
    this.ready = mkdir(this.dir, { recursive: true }).then(() => undefined);
  }

  async get(key: string): Promise<Verdict | undefined> {
    await this.ready;
    try {
      const raw = await readFile(join(this.dir, keyToFilename(key)), "utf8");
      const verdict = JSON.parse(raw) as Verdict;
      return { ...verdict, cached: true };
    } catch {
      return undefined;
    }
  }

  async set(key: string, verdict: Verdict): Promise<void> {
    await this.ready;
    const toStore: Verdict = { ...verdict, cached: false };
    await writeFile(join(this.dir, keyToFilename(key)), JSON.stringify(toStore, null, 2), "utf8");
  }

  async size(): Promise<number> {
    await this.ready;
    try {
      const files = await readdir(this.dir);
      return files.filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }
}

export class MemoryVerdictCache implements VerdictCache {
  private store: Map<string, Verdict>;

  constructor() {
    this.store = new Map();
  }
  async get(key: string): Promise<Verdict | undefined> {
    const v = this.store.get(key);
    return v ? { ...v, cached: true } : undefined;
  }
  async set(key: string, verdict: Verdict): Promise<void> {
    this.store.set(key, { ...verdict, cached: false });
  }
  async size(): Promise<number> {
    return this.store.size;
  }
}
