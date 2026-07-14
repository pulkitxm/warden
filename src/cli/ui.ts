import type { DoctorReport } from "../doctor/index.ts";
import type { Verdict } from "../schema.ts";

const color = process.stderr.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c("1", s);
export const dim = (s: string) => c("2", s);

function badge(v: Verdict["verdict"], s: string): string {
  if (v === "block") return c("31", s);
  if (v === "warn") return c("33", s);
  return c("32", s);
}

export function renderVerdict(v: Verdict): string {
  const lines: string[] = [""];
  const tag = badge(v.verdict, v.verdict.toUpperCase());
  lines.push(
    `${tag}  ${bold(`${v.package}@${v.version}`)}  ${dim(`risk ${v.risk_score}/100 · ${v.source}`)}`,
  );
  if (v.categories.length) lines.push(dim(`  categories: ${v.categories.join(", ")}`));
  for (const e of v.evidence.slice(0, 6)) {
    lines.push(
      `  ${badge(v.verdict, "•")} ${e.detail}${e.file && e.file !== "-" ? dim(` (${e.file})`) : ""}`,
    );
  }
  lines.push("");
  lines.push(`  ${bold("verdict:")} ${v.summary}`);
  if (v.verdict === "block")
    lines.push(dim("  blocked before any script ran — override with --allow-risky"));
  lines.push("");
  return lines.join("\n");
}

export function renderLine(v: Verdict): string {
  return `  ${badge(v.verdict, v.verdict.toUpperCase().padEnd(5))} ${v.package}@${v.version}  ${dim(v.categories.join(", ") || "clean")}`;
}

function severityBadge(severity: string | undefined): string {
  const s = severity ?? "unknown";
  if (/critical|high/i.test(s)) return c("31", s);
  if (/moderate|medium/i.test(s)) return c("33", s);
  return dim(s);
}

export function renderDoctorReport(r: DoctorReport): string {
  const lines: string[] = ["", bold(`Warden doctor — ${r.project}`), ""];

  if (!r.issues.length) {
    lines.push(c("32", "  no dependency issues found"), "");
  } else {
    const prod = r.issues.filter((i) => i.group === "prod").length;
    lines.push(bold(`  ${r.issues.length} issue(s) found — ${prod} affect production`));
    for (const i of r.issues) {
      const where = i.installed ? `${i.name}@${i.installed}` : i.name;
      const tag =
        i.kind === "vulnerability"
          ? severityBadge(i.severity)
          : i.kind === "compromised"
            ? c("31", "compromised")
            : dim("deprecated");
      const fix = i.fixedIn ? dim(` (fixed in ${i.fixedIn})`) : "";
      lines.push(`  ${tag}  ${bold(where)} ${i.id ? dim(`[${i.id}]`) : ""}`.trimEnd());
      lines.push(`    ${i.summary}${fix}`);
    }
    lines.push("");
  }

  if (r.gate.length) {
    lines.push(bold("  supply-chain gate on candidate fixes:"));
    for (const g of r.gate) {
      lines.push(
        `  ${badge(g.verdict, g.verdict.toUpperCase().padEnd(5))} ${g.name}@${g.version}  ${dim(g.categories.join(", ") || "clean")}`,
      );
      if (g.verdict === "block") lines.push(`    ${dim(g.summary)}`);
    }
    lines.push("");
  }

  for (const u of r.unfixable) {
    lines.push(`  ${c("31", "UNFIXABLE")} ${bold(u.name)} — ${u.reason}`);
  }
  if (r.unfixable.length) lines.push("");

  if (r.unresolved.length) {
    lines.push(
      `  ${c("33", "UNASSESSED")} ${bold(`${r.unresolved.length} dependency(ies)`)} could not be checked: ${r.unresolved.join(", ")}`,
    );
    lines.push(dim("  this project is not verified clean; see the notes below"), "");
  }

  for (const p of r.plans) {
    const mark = p.id === r.recommended ? c("32", "▸ recommended") : dim("candidate");
    lines.push(`  ${bold(`plan ${p.id}`)} — ${p.label}  ${mark}`);
    for (const ch of p.changes) {
      const scope = ch.inRange ? "in range" : "out of range";
      lines.push(`    ${ch.name} ${ch.from} -> ${bold(ch.to)}  ${dim(`${ch.level}, ${scope}`)}`);
    }
    if (p.verification) {
      const steps = p.verification.steps
        .map((s) => `${s.name} ${s.ok ? c("32", "ok") : c("31", "fail")} ${dim(`${s.ms}ms`)}`)
        .join(" · ");
      const status = p.verification.passed ? c("32", "passed") : c("31", "failed");
      lines.push(`    verification: ${steps} — ${status}`);
    }
    lines.push("");
  }

  for (const n of r.notes) lines.push(dim(`  note: ${n}`));
  if (r.notes.length) lines.push("");

  if (r.applied) lines.push(c("32", "  recommended plan applied to package.json"), "");
  else if (r.recommended)
    lines.push(dim("  run wnpm doctor without --no-apply to apply the recommended plan"), "");

  return lines.join("\n");
}
