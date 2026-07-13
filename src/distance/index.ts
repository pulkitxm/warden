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

export function normalize(name: string): string {
  const bare = name.replace(/^@[^/]+\//, "").toLowerCase();
  let out = "";
  for (const ch of bare) out += HOMOGLYPHS[ch] ?? ch;
  return out.replace(/[-_.]/g, "");
}

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

const byName = new Map<string, PopularPackage>();
const byNormalized = new Map<string, PopularPackage>();
for (const p of POPULAR) {
  byName.set(p.name, p);
  byNormalized.set(normalize(p.name), p);
}

function nearestByDistance(bare: string, max: number): { term: string; distance: number } | null {
  let best: { term: string; distance: number } | null = null;
  for (const p of POPULAR) {
    const distance = damerau(bare, p.name);
    if (distance > 0 && distance <= max && (!best || distance < best.distance)) {
      best = { term: p.name, distance };
    }
  }
  return best;
}

export function popularityOf(name: string): number | undefined {
  return byName.get(name)?.weekly;
}

export interface NameMatch {
  target: string;
  targetWeekly: number;
  distance: number;
  normalizedCollision: boolean;
  homoglyph: boolean;
}

function foldDelimiters(name: string): string {
  return name.replace(/[-_.]/g, "");
}

export function findNearestPopular(name: string, maxDistance = 2): NameMatch | null {
  const bare = name.replace(/^@[^/]+\//, "").toLowerCase();
  if (bare.length < 3) return null;
  if (byName.has(bare)) return null;

  const norm = normalize(name);
  const collision = byNormalized.get(norm);
  if (collision && collision.name !== bare) {
    return {
      target: collision.name,
      targetWeekly: collision.weekly,
      distance: damerau(bare, collision.name),
      normalizedCollision: true,
      homoglyph: foldDelimiters(bare) !== foldDelimiters(collision.name.toLowerCase()),
    };
  }

  const best = nearestByDistance(bare, maxDistance);
  if (!best) return null;
  const meta = byName.get(best.term)!;
  return {
    target: best.term,
    targetWeekly: meta.weekly,
    distance: best.distance,
    normalizedCollision: false,
    homoglyph: false,
  };
}
