import { bold, c, dim } from "../../shared/ansi.ts";
import type { CorpusReport, RuleScore } from "./run.ts";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function ruleLine(name: string, score: RuleScore): string {
  const counts = `${score.truePositives}/${score.positives} found, ${score.falsePositives} false`;
  return `    ${name.padEnd(16)} precision ${percent(score.precision).padStart(6)}  recall ${percent(
    score.recall,
  ).padStart(6)}  ${dim(counts)}`;
}

export function renderCorpus(report: CorpusReport): string {
  const lines = ["", bold(`Warden intent corpus  analyzer ${report.analyzer_version}`), ""];
  lines.push(
    `  ${bold("verdicts")}        ${percent(report.verdicts.rate)}  ${report.verdicts.correct}/${
      report.totals.cases
    } cases match the expected verdict and per-claim outcomes`,
  );
  const budget = `budget ${percent(report.falsePositives.budget)}`;
  const verdict = report.falsePositives.withinBudget
    ? dim(`within ${budget}`)
    : c("31", `over ${budget}`);
  lines.push(
    `  ${bold("false positives")} ${percent(report.falsePositives.rate)}  ${
      report.falsePositives.count
    }/${report.totals.conforming} conforming shapes not allowed  ${verdict}`,
  );
  lines.push("");
  lines.push(bold("  Per rule"));
  for (const [name, score] of Object.entries(report.rules)) lines.push(ruleLine(name, score));
  lines.push("");

  const failures = report.results.filter((result) => !result.correct);
  if (failures.length) {
    lines.push(bold("  Cases that do not match reviewer truth"));
    for (const failure of failures) {
      const tag = failure.knownGap ? dim("known gap") : c("31", "regression");
      lines.push(
        `    ${failure.id.padEnd(30)} expected ${failure.expectedVerdict}, got ${failure.actualVerdict}  ${tag}`,
      );
      lines.push(`      ${dim(failure.shape)}`);
    }
    lines.push("");
  } else {
    lines.push(dim("  every case matches reviewer truth"));
    lines.push("");
  }

  if (report.staleGaps.length) {
    lines.push(bold("  Known gaps that now pass, so the list is stale"));
    for (const id of report.staleGaps) lines.push(`    ${c("31", id)}`);
    lines.push("");
  }

  lines.push(bold("  Method"));
  for (const note of report.method) lines.push(`    ${dim(note)}`);
  lines.push("");
  return lines.join("\n");
}
