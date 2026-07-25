import { BENCHMARK_CASES } from "../../benchmark/cases.ts";
import { type BenchmarkReport, runBenchmark } from "../../benchmark/run.ts";
import { ANALYZER_VERSION, EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { isQuiet } from "../../shared/output.ts";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function renderBenchmark(report: BenchmarkReport): string {
  const lines = ["", bold(`Warden benchmark  analyzer ${report.analyzer_version}`), ""];
  lines.push(
    `  ${bold("detection")}       ${percent(report.detection.rate)}  ${report.detection.caught}/${report.totals.malicious} malicious shapes stopped`,
  );
  lines.push(
    `  ${bold("false positives")} ${percent(report.falsePositives.rate)}  ${report.falsePositives.count}/${report.totals.benign} benign shapes stopped`,
  );
  lines.push(
    `  ${bold("mean coverage")}   ${percent(report.meanCoverage)}  of changed packages analyzed`,
  );
  lines.push("");

  const failures = report.results.filter((result) => !result.correct);
  if (failures.length) {
    lines.push(bold("  Cases that did not match the expected decision"));
    for (const failure of failures) {
      lines.push(
        `    ${c("31", failure.id.padEnd(26))} expected ${failure.expected}, got ${failure.actual}`,
      );
      lines.push(`      ${dim(failure.shape)}`);
    }
    lines.push("");
  } else {
    lines.push(dim("  every case matched its expected decision"));
    lines.push("");
  }

  lines.push(bold("  Method"));
  for (const note of report.method) lines.push(`    ${dim(note)}`);
  lines.push("");
  return lines.join("\n");
}

export async function runWardenBenchmark(argv: string[], deps: WardenDeps): Promise<number> {
  const report = await runBenchmark(BENCHMARK_CASES, ANALYZER_VERSION);
  if (argv.includes("--json")) {
    deps.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!isQuiet()) {
    deps.stderr(renderBenchmark(report));
  }
  return report.results.every((result) => result.correct) ? EXIT.allow : EXIT.block;
}
