/**
 * Verdict cache, keyed by `dist.integrity` (the tarball's SRI hash).
 *
 * A package version's bytes are immutable, so a verdict for a given integrity is
 * valid forever and for everyone — this is what makes analysis O(unique versions
 * installed) instead of O(installs). Entries are invalidated when the analyzer
 * version changes (heuristics improved). Backed by bun:sqlite (zero install).
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Verdict } from "./schema.ts";

export class VerdictCache {
  private db: Database;

  constructor(path = process.env.WNPM_CACHE ?? join(homedir(), ".wnpm-cache", "verdicts.sqlite")) {
    this.db = new Database(path, { create: true });
    this.db.run(
      "CREATE TABLE IF NOT EXISTS verdicts (integrity TEXT PRIMARY KEY, analyzer_version TEXT, json TEXT, created_at INTEGER)",
    );
  }

  /** Return the cached verdict for an integrity, or null on miss / stale analyzer. */
  get(integrity: string, analyzerVersion: string): Verdict | null {
    const row = this.db
      .query<{ json: string; analyzer_version: string }, [string]>(
        "SELECT json, analyzer_version FROM verdicts WHERE integrity = ?",
      )
      .get(integrity);
    if (!row || row.analyzer_version !== analyzerVersion) return null;
    const verdict = JSON.parse(row.json) as Verdict;
    return { ...verdict, source: "cache" };
  }

  set(integrity: string, verdict: Verdict, createdAt: number): void {
    this.db.run("INSERT OR REPLACE INTO verdicts (integrity, analyzer_version, json, created_at) VALUES (?, ?, ?, ?)", [
      integrity,
      verdict.analyzer_version,
      JSON.stringify(verdict),
      createdAt,
    ]);
  }

  size(): number {
    return (this.db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM verdicts").get()?.n ?? 0);
  }
}
