import { cmp, parseVersion, sortVersions } from "./semver.ts";

const osvBase = () => process.env.WNPM_OSV ?? "https://api.osv.dev";

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface OsvRange {
  type?: string;
  events?: OsvEvent[];
}

export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  ranges?: OsvRange[];
  versions?: string[];
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: OsvAffected[];
}

export async function fetchVulns(name: string, timeoutMs = 10_000): Promise<OsvVuln[] | null> {
  try {
    const res = await fetch(`${osvBase()}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem: "npm" } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { vulns?: OsvVuln[] };
    return data.vulns ?? [];
  } catch {
    return null;
  }
}

function entriesFor(vuln: OsvVuln, name: string): OsvAffected[] {
  return (vuln.affected ?? []).filter(
    (a) => a.package?.name === name && (a.package?.ecosystem ?? "npm") === "npm",
  );
}

function inSemverRange(version: string, events: OsvEvent[]): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  let affected = false;
  for (const e of events) {
    if (e.introduced !== undefined) {
      const lo = e.introduced === "0" ? null : parseVersion(e.introduced);
      if (!lo || cmp(v, lo) >= 0) affected = true;
    } else if (e.fixed !== undefined) {
      const hi = parseVersion(e.fixed);
      if (affected && hi && cmp(v, hi) >= 0) affected = false;
    } else if (e.last_affected !== undefined) {
      const hi = parseVersion(e.last_affected);
      if (affected && hi && cmp(v, hi) > 0) affected = false;
    }
  }
  return affected;
}

export function affectsVersion(vuln: OsvVuln, name: string, version: string): boolean {
  for (const entry of entriesFor(vuln, name)) {
    if (entry.versions?.includes(version)) return true;
    for (const range of entry.ranges ?? []) {
      if (range.type === "SEMVER" && range.events && inSemverRange(version, range.events)) {
        return true;
      }
    }
  }
  return false;
}

export function fixedVersions(vuln: OsvVuln, name: string): string[] {
  const out = new Set<string>();
  for (const entry of entriesFor(vuln, name)) {
    for (const range of entry.ranges ?? []) {
      for (const e of range.events ?? []) {
        if (e.fixed && parseVersion(e.fixed)) out.add(e.fixed);
      }
    }
  }
  return sortVersions([...out]);
}

export function severityOf(vuln: OsvVuln): string {
  const label = vuln.database_specific?.severity;
  if (label) return label.toLowerCase();
  const cvss = vuln.severity?.find((s) => s.score);
  if (cvss?.score) return `${cvss.type ?? "CVSS"} ${cvss.score}`;
  return "unknown";
}

export function summaryOf(vuln: OsvVuln): string {
  return vuln.summary ?? vuln.details?.split("\n")[0] ?? vuln.id;
}
