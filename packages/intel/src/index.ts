/**
 * Malicious-package blocklist lookup.
 *
 * Overlays the free OSV `MAL-` advisories + OpenSSF malicious-packages feed. A
 * hit is a hard block before any analysis runs. An entry with no `versions`
 * blocks the whole package (OSV `introduced: "0"`). The bundled data is a seed
 * of verified real incidents; scripts/fetch-intel.ts refreshes it from the OSV
 * bulk zip + the OpenSSF repo.
 */

import blocklistData from "../data/blocklist.json" with { type: "json" };

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

  /** Match `name@version` against the blocklist. Whole-package entries (no
   * `versions`) match any version. */
  match(name: string, version?: string): BlocklistEntry | null {
    for (const e of this.byName.get(name) ?? []) {
      if (!e.versions || e.versions.length === 0) return e; // whole package
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
