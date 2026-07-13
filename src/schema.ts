/**
 * THE CONTRACT. One source of truth for three consumers: our TS types, the LLM
 * (OpenAI Structured Outputs, strict), and the coding agent that gates on the
 * JSON. Frozen after Monday noon. A drift test asserts the TS types and the
 * JSON Schema constant cannot diverge.
 */

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

/** Evidence pointer surfaced to humans and agents. */
export interface Evidence {
  file: string;
  line?: number;
  detail: string;
}

/** A single weighted detection produced by a pure heuristic. */
export interface Signal {
  /** Stable kebab-case id, e.g. "install-script-added". */
  id: string;
  category: Category;
  /** 0-100 contribution to the risk score. */
  weight: number;
  confidence: Confidence;
  evidence: Evidence;
  /**
   * A concrete risky action (script/network/obfuscation/malware). Newness-only
   * signals (recent publish, low installs) set this false and only count when
   * some action signal is also present.
   */
  action?: boolean;
  /** Newness signal that requires an action signal to count. */
  requiresAction?: boolean;
}

/** The stable verdict object. Emitted as exactly one JSON object on stdout. */
export interface Verdict {
  schema_version: typeof SCHEMA_VERSION;
  package: string;
  version: string;
  /** sha512-... — the content-address cache key. */
  integrity: string;
  verdict: VerdictLevel;
  /** 0-100. */
  risk_score: number;
  categories: Category[];
  summary: string;
  evidence: Evidence[];
  analyzer_version: string;
  source: VerdictSource;
}

/**
 * JSON Schema for {@link Verdict}. Hand-written and kept in lockstep with the
 * type by the drift test. This exact object is what we hand OpenAI Structured
 * Outputs (strict: true → every field required, additionalProperties:false) and
 * what `wnpm schema` prints for an agent to self-describe.
 */
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

/** Exit codes (the CI gate contract). */
export const EXIT = {
  allow: 0,
  warn: 10,
  block: 20,
  error: 30,
} as const;

export function exitCodeFor(v: VerdictLevel): number {
  return EXIT[v];
}
