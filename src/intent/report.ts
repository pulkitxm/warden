import { bold, dim } from "../shared/ansi.ts";
import type { ClaimRow, DependencyRule, IntentReport } from "./types.ts";

const DEPENDENCY_LABELS: Record<DependencyRule, string> = {
  undeclared_import: "UNDECLARED",
  known_hallucinated_name: "HALLUCINATED NAME",
  unpublished_package: "NOT ON THE REGISTRY",
};

function icon(row: ClaimRow): string {
  if (row.verdict === "delivered") return "✅";
  if (row.verdict === "partial") return "⚠️";
  return "❌";
}

function label(row: ClaimRow): string {
  if (row.verdict !== "dropped") return row.claim;
  if (row.kind === "preservation") return `NOT PRESERVED: ${row.claim}`;
  return `DROPPED: ${row.claim}`;
}

export function intentSummaryLine(report: IntentReport): string {
  const delivered = report.claims.filter((row) => row.verdict === "delivered").length;
  const dropped = report.claims.filter((row) => row.verdict === "dropped").length;
  const blockingDeps = report.dependencies.filter((finding) => finding.level === "block").length;
  const partial =
    report.claims.filter((row) => row.verdict === "partial").length +
    report.scope_creep.length +
    (report.dependencies.length - blockingDeps);
  const flagged = report.hallucinations.length + blockingDeps;
  return `${delivered} ✅ · ${dropped} ❌ · ${partial} ⚠️ · ${flagged} 🚨`;
}

export function renderIntentReport(report: IntentReport): string {
  const lines: string[] = ["", `${bold("VERDICT:")} ${intentSummaryLine(report)}`, ""];
  if (report.claims_status === "unverifiable") {
    lines.push(`  ⚠️ CLAIMS NOT VERIFIED: the prompt could not be decomposed`);
  }
  for (const row of report.claims) {
    const refs = row.hunk_refs.length ? row.hunk_refs.join(", ") : (row.evidence[0]?.detail ?? "");
    lines.push(`  ${icon(row)} ${label(row)}  ${dim(`[${refs}]`)}`);
  }
  for (const row of report.scope_creep) {
    lines.push(
      `  ⚠️ SCOPE CREEP: ${row.file}, ${row.added_lines} lines changed, never requested  ${dim(
        `[${row.file}:${row.line_start}-${row.line_end}]`,
      )}`,
    );
  }
  for (const finding of report.dependencies) {
    lines.push(
      `  ${finding.level === "block" ? "🚨" : "⚠️"} ${DEPENDENCY_LABELS[finding.rule]}: ${finding.package}  ${dim(`[${finding.file}:${finding.line}]`)}`,
    );
    lines.push(`     ${finding.proof}`);
    lines.push(`     fix: ${finding.fix}`);
  }
  for (const finding of report.hallucinations) {
    lines.push(`  🚨 HALLUCINATED: ${finding.symbol}  ${dim(`[${finding.file}:${finding.line}]`)}`);
    lines.push(`     ${finding.proof}`);
  }
  lines.push("");
  for (const note of report.notes) lines.push(dim(`  note: ${note}`));
  if (report.notes.length) lines.push("");
  lines.push(
    dim(
      `  prompt-as-spec · merge-base ${report.base.slice(0, 12)} · llm calls: ${
        report.llm.extract_calls + report.llm.match_calls
      }`,
    ),
  );
  lines.push("");
  return lines.join("\n");
}
