export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface Comparator {
  op: ">=" | "<=" | ">" | "<" | "=";
  v: SemVer;
}

const VERSION_RE =
  /^[v=\s]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_RE =
  /^[v=]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): SemVer | null {
  const m = VERSION_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function cmp(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePre(a.prerelease, b.prerelease);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  return cmp(pa, pb);
}

export function sortVersions(versions: string[]): string[] {
  return [...versions].sort(compareVersions);
}

export function diffLevel(from: string, to: string): "none" | "patch" | "minor" | "major" {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return "major";
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch || comparePre(a.prerelease, b.prerelease) !== 0) return "patch";
  return "none";
}

interface Partial {
  major?: number;
  minor?: number;
  patch?: number;
  prerelease: string[];
}

function parsePartial(input: string): Partial | null {
  const m = PARTIAL_RE.exec(input);
  if (!m) return null;
  const num = (s: string | undefined) =>
    s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s);
  return {
    major: num(m[1]),
    minor: num(m[2]),
    patch: num(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

function fill(p: Partial): SemVer {
  return {
    major: p.major ?? 0,
    minor: p.minor ?? 0,
    patch: p.patch ?? 0,
    prerelease: p.prerelease,
  };
}

function spanOf(p: Partial): Comparator[] {
  if (p.major === undefined) return [];
  if (p.minor === undefined) {
    return [
      { op: ">=", v: fill(p) },
      { op: "<", v: { major: p.major + 1, minor: 0, patch: 0, prerelease: [] } },
    ];
  }
  if (p.patch === undefined) {
    return [
      { op: ">=", v: fill(p) },
      { op: "<", v: { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] } },
    ];
  }
  return [{ op: "=", v: fill(p) }];
}

function caretOf(p: Partial): Comparator[] {
  if (p.major === undefined) return [];
  const lo = fill(p);
  let hi: SemVer;
  if (p.major > 0 || p.minor === undefined) {
    hi = { major: p.major + 1, minor: 0, patch: 0, prerelease: [] };
  } else if (p.minor > 0 || p.patch === undefined) {
    hi = { major: 0, minor: p.minor + 1, patch: 0, prerelease: [] };
  } else {
    hi = { major: 0, minor: p.minor, patch: (p.patch ?? 0) + 1, prerelease: [] };
  }
  return [
    { op: ">=", v: lo },
    { op: "<", v: hi },
  ];
}

function tildeOf(p: Partial): Comparator[] {
  if (p.major === undefined) return [];
  const lo = fill(p);
  const hi =
    p.minor === undefined
      ? { major: p.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
  return [
    { op: ">=", v: lo },
    { op: "<", v: hi },
  ];
}

function opOf(op: string, p: Partial): Comparator[] {
  if (p.major === undefined) return op === "<" ? [{ op: "<", v: fill(p) }] : [];
  const full = p.minor !== undefined && p.patch !== undefined;
  if (full) return [{ op: op as Comparator["op"], v: fill(p) }];
  const next: SemVer =
    p.minor === undefined
      ? { major: p.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: p.major, minor: p.minor + 1, patch: 0, prerelease: [] };
  if (op === ">") return [{ op: ">=", v: next }];
  if (op === "<=") return [{ op: "<", v: next }];
  if (op === ">=") return [{ op: ">=", v: fill(p) }];
  if (op === "<") return [{ op: "<", v: fill(p) }];
  return spanOf(p);
}

function tokenComparators(token: string): Comparator[] | null {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token) as RegExpExecArray;
  const op = m[1];
  const rest = m[2] ?? "";
  const p = parsePartial(rest);
  if (!p) return null;
  if (op === "^") return caretOf(p);
  if (op === "~") return tildeOf(p);
  if (op) return opOf(op, p);
  return spanOf(p);
}

function unitComparators(unit: string): Comparator[] | null {
  const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(unit);
  if (hyphen) {
    const lo = tokenComparators(`>=${hyphen[1]}`);
    const hi = tokenComparators(`<=${hyphen[2]}`);
    if (!lo || !hi) return null;
    return [...lo, ...hi];
  }
  const tokens = unit.trim().split(/\s+/).filter(Boolean);
  const out: Comparator[] = [];
  for (const t of tokens) {
    if (t === "*" || /^[xX]$/.test(t)) continue;
    const cs = tokenComparators(t);
    if (!cs) return null;
    out.push(...cs);
  }
  return out;
}

function matches(v: SemVer, c: Comparator): boolean {
  const d = cmp(v, c.v);
  if (c.op === "=") return d === 0;
  if (c.op === ">") return d > 0;
  if (c.op === ">=") return d >= 0;
  if (c.op === "<") return d < 0;
  return d <= 0;
}

function preAllowed(v: SemVer, comparators: Comparator[]): boolean {
  if (!v.prerelease.length) return true;
  return comparators.some(
    (c) =>
      c.v.prerelease.length &&
      c.v.major === v.major &&
      c.v.minor === v.minor &&
      c.v.patch === v.patch,
  );
}

export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  for (const unit of range.split("||")) {
    const cs = unitComparators(unit);
    if (!cs) continue;
    if (cs.every((c) => matches(v, c)) && preAllowed(v, cs)) return true;
  }
  return false;
}

export function minSatisfying(versions: string[], range: string): string | undefined {
  return sortVersions(versions).find((v) => satisfies(v, range));
}

export function maxSatisfying(versions: string[], range: string): string | undefined {
  return sortVersions(versions)
    .reverse()
    .find((v) => satisfies(v, range));
}
