export interface FixtureVerdict {
  spec: string;
  verdict: "allow" | "warn" | "block";
  risk: number;
  categories: string[];
  headline?: string;
  evidence: string[];
  summary: string;
  exit: number;
  source: string;
}

export const FIXTURE_VERDICTS: FixtureVerdict[] = [
  {
    spec: "express@5.1.0",
    verdict: "allow",
    risk: 0,
    categories: [],
    evidence: ["no dangerous capability found", "established package, provenance unchanged"],
    summary: "No supply-chain risk signals of concern.",
    exit: 0,
    source: "heuristics",
  },
  {
    spec: "lodahs@0.0.1-security",
    verdict: "block",
    risk: 60,
    categories: ["typosquat"],
    evidence: [
      'name is 1 edit from popular package "lodash"',
      "published days ago with negligible downloads",
    ],
    summary: "Name is one character from a far more popular package.",
    exit: 20,
    source: "heuristics",
  },
  {
    spec: "chalk@5.6.1",
    verdict: "block",
    risk: 100,
    categories: ["known_malware"],
    headline: "known malware: this exact version appears on the compromised-release blocklist",
    evidence: ["blocklist entry MAL-CHALK-2025", "browser wallet hooking in bundled code"],
    summary: "chalk@5.6.1 is on the known-malware blocklist. Installation blocked.",
    exit: 20,
    source: "blocklist",
  },
  {
    spec: "react-codeshift",
    verdict: "block",
    risk: 90,
    categories: ["slopsquat"],
    headline: "slopsquat: this name matches a known LLM hallucination, not a real package",
    evidence: ["on the curated hallucinated-name list", "conflates jscodeshift and react-codemod"],
    summary: "A coding agent invented this name. Do not install or execute it.",
    exit: 20,
    source: "blocklist",
  },
  {
    spec: "axios@1.14.1",
    verdict: "block",
    risk: 92,
    categories: ["provenance_downgrade", "metadata_anomaly"],
    headline:
      "provenance downgrade: this release abandoned the trusted publisher flow the previous one used",
    evidence: [
      "previous release published through OIDC; this one published from a bare CLI",
      "publisher email changed between versions",
      "new dependency added with no other meaningful manifest change",
    ],
    summary: "The publishing path changed in a way that matches a maintainer-account compromise.",
    exit: 20,
    source: "heuristics",
  },
  {
    spec: "left-pad@1.3.0",
    verdict: "warn",
    risk: 15,
    categories: ["metadata_anomaly"],
    evidence: ["package is deprecated", "no dangerous capability found"],
    summary: "Deprecated, but no dangerous capability was found.",
    exit: 10,
    source: "heuristics",
  },
];

export function findFixture(query: string): FixtureVerdict | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    FIXTURE_VERDICTS.find((entry) => entry.spec.toLowerCase() === needle) ??
    FIXTURE_VERDICTS.find((entry) => entry.spec.split("@")[0]?.toLowerCase() === needle) ??
    FIXTURE_VERDICTS.find((entry) => entry.spec.toLowerCase().startsWith(needle))
  );
}
