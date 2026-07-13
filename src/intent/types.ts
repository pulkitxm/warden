import type { Evidence, VerdictLevel } from "../schema.ts";

export type ClaimKind = "behavior" | "preservation" | "constraint" | "structural";

export interface IntentClaim {
  id: string;
  claim: string;
  kind: ClaimKind;
  keywords: string[];
  sourceText: string;
}

export interface IntentLedger {
  schema_version: 1;
  source: "prompt";
  source_text: string;
  claims: IntentClaim[];
}

export type HunkCategory =
  | "new_function"
  | "signature_change"
  | "import_added"
  | "import_removed"
  | "conditional_changed"
  | "assignment_changed"
  | "formatting_only"
  | "deletion"
  | "test_or_doc"
  | "other";

export interface RawHunk {
  file: string;
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface FileDiff {
  file: string;
  renamedFrom?: string;
  binary: boolean;
  added: boolean;
  deleted: boolean;
  hunks: RawHunk[];
}

export interface ClassifiedHunk {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  category: HunkCategory;
  summary: string;
  symbols: string[];
  imports: string[];
  addedLines: number;
  excerpt: string;
}

export interface ApiSurface {
  root: string[];
  instances: Record<string, { via: string[]; members: string[] }>;
  closed: boolean;
}

export interface HallucinationFinding {
  symbol: string;
  package: string;
  file: string;
  line: number;
  proof: string;
  source: "curated" | "node_modules";
}

export type ClaimStatus = "delivered" | "partial" | "dropped";

export interface MatchProposal {
  claimId: string;
  hunkIds: string[];
  status: ClaimStatus;
  origin: "keyword" | "llm";
}

export interface ClaimRow {
  claim_id: string;
  claim: string;
  kind: ClaimKind;
  verdict: ClaimStatus;
  hunk_refs: string[];
  evidence: Evidence[];
  origin: "keyword" | "llm" | "preservation" | "none";
}

export interface ScopeCreepRow {
  hunk_id: string;
  file: string;
  line_start: number;
  line_end: number;
  added_lines: number;
  summary: string;
}

export interface IntentReport {
  schema_version: 1;
  source: "prompt";
  prompt: string;
  base: string;
  claims: ClaimRow[];
  scope_creep: ScopeCreepRow[];
  hallucinations: HallucinationFinding[];
  verdict: VerdictLevel;
  exit: number;
  llm: { extract_calls: number; match_calls: number };
}
