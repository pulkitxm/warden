export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v: string): ParsedVersion | null {
  const m = v.trim().match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const cmp = compareIdentifiers(ai, bi);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

type Comparator = (v: ParsedVersion) => boolean;

function fill(major: number, minor?: number, patch?: number): ParsedVersion {
  return { major, minor: minor ?? 0, patch: patch ?? 0, prerelease: [] };
}

function parsePartial(s: string): { p: ParsedVersion; precision: 0 | 1 | 2 | 3 } | null {
  const t = s.replace(/^v/, "");
  if (t === "" || t === "*" || t === "x" || t === "X") return { p: fill(0), precision: 0 };
  const m = t.match(/^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  const major = Number(m[1]);
  const minorRaw = m[2];
  const patchRaw = m[3];
  const minorIsWild = minorRaw === undefined || /^[xX*]$/.test(minorRaw);
  const patchIsWild = patchRaw === undefined || /^[xX*]$/.test(patchRaw);
  if (minorIsWild) return { p: fill(major), precision: 1 };
  if (patchIsWild) return { p: fill(major, Number(minorRaw)), precision: 2 };
  const p = fill(major, Number(minorRaw), Number(patchRaw));
  if (m[4]) p.prerelease = m[4].split(".");
  return { p, precision: 3 };
}

function gte(bound: ParsedVersion): Comparator {
  return (v) => compareVersions(v, bound) >= 0;
}

function lt(bound: ParsedVersion): Comparator {
  return (v) => compareVersions(v, bound) < 0;
}

function rangeFromPartial(p: ParsedVersion, precision: 0 | 1 | 2 | 3): Comparator[] {
  if (precision === 0) return [() => true];
  if (precision === 1) return [gte(p), lt(fill(p.major + 1))];
  if (precision === 2) return [gte(p), lt(fill(p.major, p.minor + 1))];
  return [(v) => compareVersions(v, p) === 0];
}

function caret(p: ParsedVersion, precision: 1 | 2 | 3): Comparator[] {
  if (p.major > 0 || precision === 1) return [gte(p), lt(fill(p.major + 1))];
  if (p.minor > 0 || precision === 2) return [gte(p), lt(fill(0, p.minor + 1))];
  return [gte(p), lt(fill(0, p.minor, p.patch + 1))];
}

function tilde(p: ParsedVersion, precision: 1 | 2 | 3): Comparator[] {
  if (precision === 1) return [gte(p), lt(fill(p.major + 1))];
  return [gte(p), lt(fill(p.major, p.minor + 1))];
}

function comparatorFor(token: string): Comparator[] | null {
  const opMatch = token.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/);
  const op = opMatch?.[1] ?? "";
  const rest = (opMatch?.[2] ?? "").trim();
  const partial = parsePartial(rest);
  if (!partial) return null;
  const { p, precision } = partial;
  if (op === "^") return precision === 0 ? [() => true] : caret(p, precision);
  if (op === "~") return precision === 0 ? [() => true] : tilde(p, precision);
  if (op === ">=") return [gte(p)];
  if (op === ">") {
    if (precision === 1) return [gte(fill(p.major + 1))];
    if (precision === 2) return [gte(fill(p.major, p.minor + 1))];
    return [(v) => compareVersions(v, p) > 0];
  }
  if (op === "<=") {
    if (precision === 1) return [lt(fill(p.major + 1))];
    if (precision === 2) return [lt(fill(p.major, p.minor + 1))];
    return [(v) => compareVersions(v, p) <= 0];
  }
  if (op === "<") return [lt(p)];
  return rangeFromPartial(p, precision);
}

function parseRange(range: string): Comparator[][] | null {
  const groups: Comparator[][] = [];
  for (const alt of range.split(/\s*\|\|\s*/)) {
    const tokens = alt.trim().split(/\s+/).filter(Boolean);
    const comps: Comparator[] = [];
    if (tokens.length === 0) comps.push(() => true);
    for (const token of tokens) {
      const c = comparatorFor(token);
      if (!c) return null;
      comps.push(...c);
    }
    groups.push(comps);
  }
  return groups.length ? groups : null;
}

export function maxSatisfying(versions: string[], range: string): string | undefined {
  const groups = parseRange(range);
  if (!groups) return undefined;
  let best: { raw: string; parsed: ParsedVersion } | undefined;
  for (const raw of versions) {
    const parsed = parseVersion(raw);
    if (!parsed || parsed.prerelease.length) continue;
    if (!groups.some((g) => g.every((c) => c(parsed)))) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { raw, parsed };
  }
  return best?.raw;
}
