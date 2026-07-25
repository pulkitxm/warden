import type { VerdictLevel } from "../schema.ts";

export interface AuditFinding {
  rule: string;
  level: VerdictLevel;
  target: string;
  file: string;
  line?: number;
  evidence: string;
  fix: string;
}

export interface AuditReport {
  schema_version: 1;
  surface: "lockfile" | "scripts" | "config";
  root: string;
  scanned: number;
  findings: AuditFinding[];
  notes: string[];
}

export interface AuditFs {
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  glob: (pattern: string, cwd: string) => string[];
}

export function worstLevel(findings: AuditFinding[]): VerdictLevel {
  if (findings.some((f) => f.level === "block")) return "block";
  if (findings.some((f) => f.level === "warn")) return "warn";
  return "allow";
}
