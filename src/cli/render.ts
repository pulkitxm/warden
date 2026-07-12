import type { Verdict } from "../types.js";

const c = (code: string, s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c("1", s);
export const dim = (s: string) => c("2", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const green = (s: string) => c("32", s);

export function levelColor(level: Verdict["level"], s: string): string {
  if (level === "HIGH") return red(s);
  if (level === "MEDIUM") return yellow(s);
  return green(s);
}

export function renderVerdict(v: Verdict): string {
  const lines: string[] = [];
  const badge = levelColor(v.level, `${v.level} RISK`);
  const cached = v.cached ? dim(" (cached)") : "";
  lines.push("");
  lines.push(`${bold(v.package)}  —  ${badge}  ${dim(`score ${v.risk_score}/10`)}${cached}`);
  if (v.evidence.length) {
    lines.push("");
    for (const e of v.evidence) lines.push(`  ${levelColor(v.level, "•")} ${e}`);
  }
  lines.push("");
  lines.push(`  ${bold("verdict:")} ${v.explanation}`);
  lines.push(`  ${bold("recommendation:")} ${v.recommendation.replace(/_/g, " ")}`);
  if (v.level === "HIGH") {
    lines.push(dim("  (blocked by default — override with --allow-risky)"));
  }
  lines.push("");
  return lines.join("\n");
}

export function renderVerdictLine(v: Verdict): string {
  const badge = levelColor(v.level, v.level.padEnd(6));
  return `  ${badge} ${v.package}  ${dim(v.flags.join(", ") || "no signals")}`;
}
