/**
 * Name-similarity for typosquat detection.
 *
 * Two mechanisms, both cheap:
 *  - Damerau-Levenshtein (Levenshtein + adjacent transposition) — catches
 *    single edits and swaps: lodahs↔lodash, chlak↔chalk.
 *  - Normalized collision — lowercase + homoglyph fold + delimiter strip, so
 *    g00gle→google and cross_env→cross-env collapse to the same key.
 *
 * A BK-tree over the popular-name set makes nearest-within-k queries fast at
 * 10k+ names. This package only measures similarity; it deliberately does NOT
 * decide "block". Delimiter/plural variants of real packages (class-names vs
 * classnames) are genuine near-collisions, so the scorer requires a second
 * signal (popularity gap, install script, ...) before blocking — see
 * @warden/score. That is why a match here carries the raw distance and the
 * target's popularity, not a verdict.
 */

import { POPULAR, type PopularPackage } from "./popular.ts";

const HOMOGLYPHS: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "|": "l",
};

/** Strip scope, lowercase, fold homoglyphs, remove delimiters. */
export function normalize(name: string): string {
  const bare = name.replace(/^@[^/]+\//, "").toLowerCase();
  let out = "";
  for (const ch of bare) out += HOMOGLYPHS[ch] ?? ch;
  return out.replace(/[-_.]/g, "");
}

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function damerau(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

/** BK-tree over a fixed corpus for fast distance-bounded nearest queries. */
class BKTree {
  private root: { term: string; children: Map<number, BKTreeNode> } | null = null;
  add(term: string): void {
    if (!this.root) {
      this.root = { term, children: new Map() };
      return;
    }
    let node: BKTreeNode = this.root;
    for (;;) {
      const dist = damerau(term, node.term);
      if (dist === 0) return;
      const child = node.children.get(dist);
      if (!child) {
        node.children.set(dist, { term, children: new Map() });
        return;
      }
      node = child;
    }
  }
  /** All corpus terms within `max` edits of `query`, nearest first. */
  query(query: string, max: number): Array<{ term: string; distance: number }> {
    if (!this.root) return [];
    const out: Array<{ term: string; distance: number }> = [];
    const stack: BKTreeNode[] = [this.root];
    while (stack.length) {
      const node = stack.pop()!;
      const dist = damerau(query, node.term);
      if (dist <= max) out.push({ term: node.term, distance: dist });
      for (let d = dist - max; d <= dist + max; d++) {
        const child = node.children.get(d);
        if (child) stack.push(child);
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}
interface BKTreeNode {
  term: string;
  children: Map<number, BKTreeNode>;
}

const tree = new BKTree();
const byName = new Map<string, PopularPackage>();
const byNormalized = new Map<string, PopularPackage>();
for (const p of POPULAR) {
  tree.add(p.name);
  byName.set(p.name, p);
  byNormalized.set(normalize(p.name), p);
}

/** Weekly downloads if `name` is a known popular package (exact match), else
 * undefined. Used as the establishment fallback (when the downloads API is
 * unavailable) and by scoped-impersonation detection on the unscoped part. */
export function popularityOf(name: string): number | undefined {
  return byName.get(name)?.weekly;
}

export interface NameMatch {
  /** The popular package the candidate resembles. */
  target: string;
  targetWeekly: number;
  /** Raw Damerau distance between the candidate and the target names. */
  distance: number;
  /** True when the only difference is homoglyph/delimiter (normalized-equal). */
  normalizedCollision: boolean;
}

/**
 * Nearest popular package to `name` within `maxDistance`, or null. Returns null
 * when `name` IS a popular package (it is the real thing, not a squat). Names
 * shorter than 3 chars are skipped to avoid noise. The caller decides severity
 * using `distance`, `targetWeekly`, and `normalizedCollision`.
 */
export function findNearestPopular(name: string, maxDistance = 2): NameMatch | null {
  const bare = name.replace(/^@[^/]+\//, "").toLowerCase();
  if (bare.length < 3) return null;
  if (byName.has(bare)) return null; // it is the real package

  // Homoglyph/delimiter collision: normalized form equals a popular package's.
  const norm = normalize(name);
  const collision = byNormalized.get(norm);
  if (collision && collision.name !== bare) {
    return {
      target: collision.name,
      targetWeekly: collision.weekly,
      distance: damerau(bare, collision.name),
      normalizedCollision: true,
    };
  }

  const hits = tree.query(bare, maxDistance).filter((h) => h.distance > 0);
  if (!hits.length) return null;
  const best = hits[0]!;
  const meta = byName.get(best.term)!;
  return {
    target: best.term,
    targetWeekly: meta.weekly,
    distance: best.distance,
    normalizedCollision: false,
  };
}
