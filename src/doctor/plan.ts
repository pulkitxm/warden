import { compareVersions, diffLevel, parseVersion, satisfies, sortVersions } from "../semver.ts";
import { affectsVersion, fixedVersions, type OsvVuln, severityOf, summaryOf } from "../vuln.ts";

export interface DepAudit {
  name: string;
  range: string;
  group: "prod" | "dev";
  installed?: string;
  versions: string[];
  vulns: OsvVuln[];
  deprecated: boolean;
  blocklistId?: string;
  notes: string[];
}

export type IssueKind = "vulnerability" | "compromised" | "deprecated";

export interface Issue {
  name: string;
  group: "prod" | "dev";
  installed?: string;
  kind: IssueKind;
  id?: string;
  severity?: string;
  summary: string;
  fixedIn?: string;
}

export interface Change {
  name: string;
  from: string;
  to: string;
  inRange: boolean;
  level: "none" | "patch" | "minor" | "major";
}

export function issuesOf(audit: DepAudit): Issue[] {
  const out: Issue[] = [];
  if (audit.blocklistId) {
    out.push({
      name: audit.name,
      group: audit.group,
      installed: audit.installed,
      kind: "compromised",
      id: audit.blocklistId,
      severity: "critical",
      summary: `installed version is on the known-malware blocklist (${audit.blocklistId})`,
    });
  }
  if (audit.installed) {
    for (const vuln of audit.vulns) {
      if (!affectsVersion(vuln, audit.name, audit.installed)) continue;
      out.push({
        name: audit.name,
        group: audit.group,
        installed: audit.installed,
        kind: "vulnerability",
        id: vuln.id,
        severity: severityOf(vuln),
        summary: summaryOf(vuln),
        fixedIn: fixedVersions(vuln, audit.name).find(
          (f) => compareVersions(f, audit.installed as string) > 0,
        ),
      });
    }
  }
  if (audit.deprecated) {
    out.push({
      name: audit.name,
      group: audit.group,
      installed: audit.installed,
      kind: "deprecated",
      summary: `the latest release of ${audit.name} is deprecated on the registry`,
    });
  }
  return out;
}

export function safeUpgrades(audit: DepAudit): string[] {
  const installed = audit.installed;
  if (!installed) return [];
  return sortVersions(audit.versions).filter((v) => {
    const parsed = parseVersion(v);
    if (!parsed || parsed.prerelease.length) return false;
    if (compareVersions(v, installed) <= 0) return false;
    return audit.vulns.every((vuln) => !affectsVersion(vuln, audit.name, v));
  });
}

export function candidateOrder(audit: DepAudit, direction: "minimal" | "latest"): string[] {
  const safe = safeUpgrades(audit);
  if (direction === "latest") return [...safe].reverse();
  const inRange = safe.filter((v) => satisfies(v, audit.range));
  const outRange = safe.filter((v) => !satisfies(v, audit.range));
  return [...inRange, ...outRange];
}

export function changeFor(audit: DepAudit, to: string): Change {
  const from = audit.installed as string;
  return {
    name: audit.name,
    from,
    to,
    inRange: satisfies(to, audit.range),
    level: diffLevel(from, to),
  };
}

export function sameChanges(a: Change[], b: Change[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.name === b[i]?.name && c.to === b[i]?.to);
}
