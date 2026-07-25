import type { PackageMeta } from "../registry.ts";
import type { Verdict, VerdictLevel } from "../schema.ts";

export interface ExplainReport {
  schema_version: 1;
  package: string;
  version: string;
  decision: VerdictLevel;
  confidence: "low" | "medium" | "high";
  reason_codes: string[];
  what_changed: string[];
  why_it_matters: string[];
  prevented: string[];
  next_actions: string[];
  baseline: { version: string; source: string } | null;
  analysis_limits: string[];
  heuristic_score: number;
  evidence: Array<{ file: string; line?: number; detail: string }>;
  analyzer_version: string;
}

const CATEGORY_MEANING: Record<string, string> = {
  known_malware: "this exact release appears in curated malware intelligence",
  typosquat: "the name is a near miss for a far more popular package",
  slopsquat: "the name matches a pattern language models are known to invent",
  install_script: "code in this package runs at install time, before you import anything",
  obfuscation: "the published code is encoded or generated in a way that hides what it does",
  exfiltration: "the code reads local secrets and sends them somewhere",
  provenance_downgrade: "the publishing chain weakened compared with the previous release",
  metadata_anomaly: "the release metadata does not line up with the package's own history",
};

const CATEGORY_PREVENTED: Record<string, string> = {
  known_malware: "the tarball was never unpacked into node_modules",
  install_script: "the install script did not execute",
  exfiltration: "no environment variable left this machine",
  obfuscation: "the obfuscated module was not loaded",
};

export function confidenceOf(verdict: Verdict): "low" | "medium" | "high" {
  if (verdict.source === "blocklist") return "high";
  if (verdict.categories.includes("known_malware")) return "high";
  if (verdict.verdict === "allow") return verdict.source === "cache" ? "medium" : "high";
  if (verdict.evidence.length > 1) return "high";
  return verdict.evidence.length ? "medium" : "low";
}

function whatChanged(verdict: Verdict, meta: PackageMeta | null): string[] {
  const out: string[] = [];
  if (!meta) return out;
  if (!meta.existsOnRegistry) return ["this name is not published on the registry"];
  if (meta.previousVersion) out.push(`${meta.previousVersion} to ${verdict.version}`);
  else out.push(`${verdict.package}@${verdict.version} is the first release seen here`);

  const before = new Set(Object.keys(meta.previousScripts ?? {}));
  const added = Object.keys(meta.scripts ?? {}).filter((hook) => !before.has(hook));
  if (added.length) out.push(`new scripts: ${added.join(", ")}`);

  if (meta.maintainerEmailChanged) out.push("the publishing account's email address changed");
  if (meta.previousHadProvenance && !meta.hasProvenance)
    out.push("the previous release carried provenance attestation and this one does not");
  if (meta.ageDays !== undefined && meta.ageDays < 1) out.push("published less than a day ago");
  if (meta.deprecated) out.push("the release is deprecated");
  return out;
}

export function buildExplain(
  verdict: Verdict,
  meta: PackageMeta | null,
  analyzerVersion: string,
): ExplainReport {
  const categories = [...new Set(verdict.categories)];
  const prevented =
    verdict.verdict === "block"
      ? categories.map((category) => CATEGORY_PREVENTED[category]).filter(Boolean as never)
      : [];

  const next: string[] = [];
  if (verdict.verdict === "block") {
    next.push(`warden compare ${verdict.package} <a-package-you-trust>`);
    next.push(`warden history ${verdict.package}`);
  } else if (categories.includes("install_script")) {
    next.push(`warden approve-script ${verdict.package}@${verdict.version} --hook <hook>`);
  } else {
    next.push(`warden plan -- npm install ${verdict.package}@${verdict.version}`);
  }

  return {
    schema_version: 1,
    package: verdict.package,
    version: verdict.version,
    decision: verdict.verdict,
    confidence: confidenceOf(verdict),
    reason_codes: categories,
    what_changed: whatChanged(verdict, meta),
    why_it_matters: categories.map((category) => CATEGORY_MEANING[category] ?? category),
    prevented: prevented.length
      ? prevented
      : verdict.verdict === "block"
        ? ["nothing from this package was executed"]
        : [],
    next_actions: next,
    baseline: meta?.previousVersion
      ? { version: meta.previousVersion, source: "the previous published release" }
      : null,
    analysis_limits: verdict.inventory
      ? [
          `${verdict.inventory.analyzed} of ${verdict.inventory.total} files in the tarball were read as source`,
          ...verdict.inventory.notes,
        ]
      : [],
    heuristic_score: verdict.risk_score,
    evidence: verdict.evidence,
    analyzer_version: analyzerVersion,
  };
}

export interface HistoryEntry {
  version: string;
  publishedAt?: string;
  changes: string[];
}

export function buildHistory(meta: PackageMeta, limit: number): HistoryEntry[] {
  const versions = meta.versions.slice(-limit).reverse();
  return versions.map((version) => {
    const changes: string[] = [];
    if (version === meta.version) {
      if (meta.maintainerEmailChanged) changes.push("publisher email changed");
      if (meta.previousHadProvenance && !meta.hasProvenance) changes.push("provenance lost");
      const before = new Set(Object.keys(meta.previousScripts ?? {}));
      const added = Object.keys(meta.scripts ?? {}).filter((hook) => !before.has(hook));
      if (added.length) changes.push(`scripts added: ${added.join(", ")}`);
      if (meta.deprecated) changes.push("deprecated");
    }
    return {
      version,
      ...(version === meta.version && meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
      changes,
    };
  });
}

export interface ComparisonRow {
  package: string;
  version: string;
  decision: VerdictLevel | "unknown";
  weeklyDownloads?: number;
  ageDays?: number;
  hasProvenance?: boolean;
  installScripts: string[];
  deprecated: boolean;
  summary: string;
}

export function compareRow(
  verdict: Verdict | null,
  meta: PackageMeta | null,
  name: string,
): ComparisonRow {
  return {
    package: name,
    version: verdict?.version ?? meta?.version ?? "unknown",
    decision: verdict?.verdict ?? "unknown",
    ...(meta?.weeklyDownloads === undefined ? {} : { weeklyDownloads: meta.weeklyDownloads }),
    ...(meta?.ageDays === undefined ? {} : { ageDays: Math.round(meta.ageDays) }),
    ...(meta?.hasProvenance === undefined ? {} : { hasProvenance: meta.hasProvenance }),
    installScripts: Object.keys(meta?.scripts ?? {}).filter((hook) =>
      ["preinstall", "install", "postinstall", "prepare"].includes(hook),
    ),
    deprecated: Boolean(meta?.deprecated),
    summary: verdict?.summary ?? "not analyzed",
  };
}

export function rankComparison(rows: ComparisonRow[]): ComparisonRow[] {
  const score = (row: ComparisonRow) => {
    let value = 0;
    if (row.decision === "block") value -= 1000;
    if (row.decision === "warn") value -= 100;
    if (row.decision === "unknown") value -= 500;
    if (row.deprecated) value -= 200;
    if (row.installScripts.length) value -= 50;
    if (row.hasProvenance) value += 25;
    value += Math.log10((row.weeklyDownloads ?? 0) + 1) * 10;
    return value;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}
