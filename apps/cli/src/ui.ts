/**
 * Human-readable rendering. All of it goes to STDERR — stdout is reserved for
 * the single JSON object in --json mode. Honors NO_COLOR and non-TTY output.
 */

import type { Verdict } from "@warden/schema";

const color = process.stderr.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c("1", s);
export const dim = (s: string) => c("2", s);

function badge(v: Verdict["verdict"], s: string): string {
  if (v === "block") return c("31", s); // red
  if (v === "warn") return c("33", s); // yellow
  return c("32", s); // green
}

/** Full report for one package. Returns a string; caller writes to stderr. */
export function renderVerdict(v: Verdict): string {
  const lines: string[] = [""];
  const tag = badge(v.verdict, v.verdict.toUpperCase());
  lines.push(`${tag}  ${bold(`${v.package}@${v.version}`)}  ${dim(`risk ${v.risk_score}/100 · ${v.source}`)}`);
  if (v.categories.length) lines.push(dim(`  categories: ${v.categories.join(", ")}`));
  for (const e of v.evidence.slice(0, 6)) {
    lines.push(`  ${badge(v.verdict, "•")} ${e.detail}${e.file && e.file !== "-" ? dim(` (${e.file})`) : ""}`);
  }
  lines.push("");
  lines.push(`  ${bold("verdict:")} ${v.summary}`);
  if (v.verdict === "block") lines.push(dim("  blocked before any script ran — override with --allow-risky"));
  lines.push("");
  return lines.join("\n");
}

/** One-line summary for the grouped install report. */
export function renderLine(v: Verdict): string {
  return `  ${badge(v.verdict, v.verdict.toUpperCase().padEnd(5))} ${v.package}@${v.version}  ${dim(v.categories.join(", ") || "clean")}`;
}
