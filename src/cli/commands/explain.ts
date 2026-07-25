import { parseSpec } from "../../engine.ts";
import { buildExplain, buildHistory, type ExplainReport } from "../../explain/report.ts";
import { type PackageMeta, resolvePackage } from "../../registry.ts";
import { ANALYZER_VERSION, EXIT, exitCodeFor } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { LABEL } from "./verdict-label.ts";

async function metaOrNull(name: string, version: string): Promise<PackageMeta | null> {
  try {
    return await resolvePackage(name, version);
  } catch {
    return null;
  }
}

export function renderExplain(report: ExplainReport): string {
  const lines: string[] = [
    "",
    `${LABEL[report.decision]}  ${bold(`${report.package}@${report.version}`)}`,
    `  ${dim(`confidence ${report.confidence}${report.reason_codes.length ? ` · ${report.reason_codes.join(", ")}` : ""}`)}`,
    "",
  ];

  if (report.what_changed.length) {
    lines.push(bold("What changed"));
    for (const entry of report.what_changed) lines.push(`  ${entry}`);
    lines.push("");
  }

  if (report.why_it_matters.length) {
    lines.push(bold("Why that matters here"));
    for (const entry of report.why_it_matters) lines.push(`  ${entry}`);
    lines.push("");
  }

  if (report.prevented.length) {
    lines.push(bold("Prevented"));
    for (const entry of report.prevented) lines.push(`  ${entry}`);
    lines.push("");
  }

  if (report.evidence.length) {
    lines.push(bold("Evidence"));
    for (const item of report.evidence.slice(0, 8))
      lines.push(`  ${item.file}${item.line ? `:${item.line}` : ""}  ${item.detail}`);
    if (report.evidence.length > 8)
      lines.push(dim(`  and ${report.evidence.length - 8} more findings`));
    lines.push("");
  }

  if (report.analysis_limits.length) {
    lines.push(bold("Analysis limits"));
    for (const entry of report.analysis_limits) lines.push(`  ${entry}`);
    lines.push("");
  }

  lines.push(bold("Safe next action"));
  for (const entry of report.next_actions) lines.push(`  ${entry}`);
  lines.push("");
  lines.push(
    dim(
      `  baseline: ${report.baseline ? `${report.baseline.version}, ${report.baseline.source}` : "none; this is the first release"}`,
    ),
  );
  lines.push(
    dim(`  heuristic score ${report.heuristic_score}/100, analyzer ${report.analyzer_version}`),
  );
  lines.push("");
  return lines.join("\n");
}

export async function runWardenExplain(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const spec = argv.find((arg) => !arg.startsWith("-"));
  if (!spec) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_EXPLAIN_USAGE",
      "no package was named",
      "warden explain left-pad@1.3.0",
    );
  }

  const parsed = parseSpec(spec);
  try {
    const verdict = await deps.check(spec);
    const meta = await metaOrNull(parsed.name, parsed.version ?? "latest");
    const report = buildExplain(verdict, meta, ANALYZER_VERSION);
    if (wantsJson) deps.stdout(`${JSON.stringify(report)}\n`);
    else if (!isQuiet()) deps.stderr(renderExplain(report));
    return exitCodeFor(verdict.verdict);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_EXPLAIN_ERROR",
      (error as Error).message,
      "retry once the registry is reachable",
    );
  }
}

export async function runWardenHistory(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const name = argv.find((arg) => !arg.startsWith("-"));
  if (!name) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_HISTORY_USAGE",
      "no package was named",
      "warden history left-pad",
    );
  }
  const tailIndex = argv.indexOf("--tail");
  const limit = tailIndex === -1 ? 10 : Number.parseInt(argv[tailIndex + 1] ?? "10", 10) || 10;

  let meta: PackageMeta;
  try {
    meta = await resolvePackage(parseSpec(name).name);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_HISTORY_ERROR",
      (error as Error).message,
      "retry once the registry is reachable",
    );
  }

  if (!meta.existsOnRegistry) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_HISTORY_UNKNOWN",
      `${name} is not published on the registry`,
      "check the spelling; a name that does not exist is itself a finding",
    );
  }

  const entries = buildHistory(meta, limit);
  if (wantsJson) {
    deps.stdout(
      `${JSON.stringify({ schema_version: 1, package: meta.name, latest: meta.version, entries })}\n`,
    );
    return EXIT.allow;
  }
  if (isQuiet()) return EXIT.allow;

  const lines = ["", bold(`${meta.name} release history`), ""];
  for (const entry of entries) {
    const marker = entry.version === meta.version ? c("36", "→") : " ";
    lines.push(`  ${marker} ${entry.version.padEnd(16)} ${entry.changes.join("; ")}`);
  }
  lines.push("");
  lines.push(
    dim(
      `  ${meta.versions.length} published releases, ${meta.maintainers.length} maintainers on the current one`,
    ),
  );
  lines.push("");
  deps.stderr(lines.join("\n"));
  return EXIT.allow;
}
