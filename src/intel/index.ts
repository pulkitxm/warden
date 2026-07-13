import blocklistData from "./data/blocklist.json" with { type: "json" };
import hallucinatedData from "./data/hallucinated.json" with { type: "json" };

export interface BlocklistEntry {
  id: string;
  name: string;
  versions?: string[];
  ref?: string;
}

interface BlocklistFile {
  entries: BlocklistEntry[];
}

export class Blocklist {
  private byName = new Map<string, BlocklistEntry[]>();

  constructor(entries: BlocklistEntry[] = (blocklistData as BlocklistFile).entries) {
    for (const e of entries) {
      const list = this.byName.get(e.name) ?? [];
      list.push(e);
      this.byName.set(e.name, list);
    }
  }

  match(name: string, version?: string): BlocklistEntry | null {
    for (const e of this.byName.get(name) ?? []) {
      if (!e.versions || e.versions.length === 0) return e;
      if (version && e.versions.includes(version)) return e;
    }
    return null;
  }

  size(): number {
    let n = 0;
    for (const list of this.byName.values()) n += list.length;
    return n;
  }
}

export const defaultBlocklist = new Blocklist();

export class HallucinatedNames {
  private set: Set<string>;
  constructor(names: string[] = (hallucinatedData as { names: string[] }).names) {
    this.set = new Set(names);
  }
  has(name: string): boolean {
    return this.set.has(name);
  }
}

export const defaultHallucinated = new HallucinatedNames();
