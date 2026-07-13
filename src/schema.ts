export const SCHEMA_VERSION = 1 as const;
export const ANALYZER_VERSION = "0.1.0";

export type Category =
  | "known_malware"
  | "typosquat"
  | "slopsquat"
  | "install_script"
  | "obfuscation"
  | "exfiltration"
  | "provenance_downgrade"
  | "metadata_anomaly";

export const CATEGORIES: Category[] = [
  "known_malware",
  "typosquat",
  "slopsquat",
  "install_script",
  "obfuscation",
  "exfiltration",
  "provenance_downgrade",
  "metadata_anomaly",
];

export type Confidence = "low" | "medium" | "high";
export type VerdictLevel = "allow" | "warn" | "block";
export type VerdictSource = "cache" | "blocklist" | "heuristics" | "llm";

export interface Evidence {
  file: string;
  line?: number;
  detail: string;
}

export interface Signal {
  id: string;
  category: Category;
  weight: number;
  confidence: Confidence;
  evidence: Evidence;
  action?: boolean;
  requiresAction?: boolean;
}

export interface Verdict {
  schema_version: typeof SCHEMA_VERSION;
  package: string;
  version: string;
  integrity: string;
  verdict: VerdictLevel;
  risk_score: number;
  categories: Category[];
  summary: string;
  evidence: Evidence[];
  analyzer_version: string;
  source: VerdictSource;
}

export const VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "package",
    "version",
    "integrity",
    "verdict",
    "risk_score",
    "categories",
    "summary",
    "evidence",
    "analyzer_version",
    "source",
  ],
  properties: {
    schema_version: { type: "integer", const: SCHEMA_VERSION },
    package: { type: "string" },
    version: { type: "string" },
    integrity: { type: "string" },
    verdict: { type: "string", enum: ["allow", "warn", "block"] },
    risk_score: { type: "integer", minimum: 0, maximum: 100 },
    categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
    summary: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "detail"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          detail: { type: "string" },
        },
      },
    },
    analyzer_version: { type: "string" },
    source: { type: "string", enum: ["cache", "blocklist", "heuristics", "llm"] },
  },
} as const;

export const EXIT = {
  allow: 0,
  warn: 10,
  block: 20,
  error: 30,
} as const;

export function exitCodeFor(v: VerdictLevel): number {
  return EXIT[v];
}
