import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AuditFinding } from "../../audit/types.ts";
import { runIntentPipeline } from "../../intent/index.ts";
import { intentSummaryLine } from "../../intent/report.ts";
import type { IntentReport } from "../../intent/types.ts";
import { LOCK_FORMATS, UNREADABLE_LOCKFILES } from "../../lockfile.ts";
import { type CiFinding, exitCodeFor, SCHEMA_VERSION, type Verdict } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { gitResult, resolveMergeBase } from "../../shared/git.ts";
import { isQuiet } from "../../shared/output.ts";
import { progressCount, progressStep } from "../../shared/progress.ts";
import { toSarif } from "../../shared/sarif.ts";
import { type CheckSurface, runSurfaceAudit } from "./check.ts";
import { receiptFindings } from "./ci-receipt.ts";
import { jsonFile, type PackageJson } from "./detect.ts";

function dependencyMap(pkg: PackageJson): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
}

function findingFor(
  verdict: Verdict,
  file: string,
  line: number | undefined,
  level: Verdict["verdict"],
): CiFinding {
  const name = `${verdict.package}@${verdict.version}`;
  return {
    schema_version: SCHEMA_VERSION,
    rule: verdict.categories[0] ?? `dependency.${verdict.verdict}`,
    package: name,
    file,
    ...(line ? { line } : {}),
    level,
    evidence: verdict.evidence.map((item) => item.detail).join("; ") || verdict.summary,
    fix: `replace or remove ${name}, then reinstall dependencies`,
    verify: "warden ci --reporter agent",
    seen_before: false,
  };
}

const SURFACE_TRIGGERS: Array<{ surface: CheckSurface; matches: (file: string) => boolean }> = [
  {
    surface: "lockfile",
    matches: (file) => LOCKFILES.includes(file.split("/").pop() ?? ""),
  },
  { surface: "scripts", matches: (file) => /(^|\/)package\.json$/.test(file) },
  { surface: "config", matches: (file) => /(^|\/)\.npmrc$/.test(file) },
];

function surfaceFinding(finding: AuditFinding, failOn: string): CiFinding {
  const level = failOn === "warn" && finding.level === "warn" ? "block" : finding.level;
  return {
    schema_version: SCHEMA_VERSION,
    rule: finding.rule,
    package: finding.target,
    file: finding.file,
    ...(finding.line ? { line: finding.line } : {}),
    level,
    evidence: finding.evidence,
    fix: finding.fix,
    verify: "warden ci --reporter agent",
    seen_before: false,
  };
}

function ciSummary(findings: CiFinding[], base: string, changed: number): string {
  const rows = findings.length
    ? findings
        .map(
          (finding) =>
            `  deps  ${finding.level.toUpperCase().padEnd(5)} ${finding.package}  ${finding.file}  ${finding.evidence}`,
        )
        .join("\n")
    : "  no dependency changes";
  return `Warden CI · diff vs merge-base ${base} · ${changed} package${changed === 1 ? "" : "s"} changed\n\n${rows}\n`;
}

function annotationValue(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

const LOCKFILES = [
  ...LOCK_FORMATS.map((format) => format.file),
  ...UNREADABLE_LOCKFILES.map((entry) => entry.file),
];

export async function runWardenCi(argv: string[], deps: WardenDeps): Promise<number> {
  const jsonReporter = argv.some(
    (arg, index) =>
      (arg === "--reporter" && ["json", "agent", "sarif"].includes(argv[index + 1] ?? "")) ||
      arg === "--reporter=json" ||
      arg === "--reporter=agent" ||
      arg === "--reporter=sarif",
  );
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        reporter: { type: "string", default: "summary" },
        base: { type: "string" },
        "intent-prompt": { type: "string" },
        "require-transaction-receipt": { type: "boolean", default: false },
      },
    });
    if (
      !values.reporter ||
      !["summary", "json", "github", "agent", "sarif"].includes(values.reporter)
    )
      throw new Error(`invalid reporter "${values.reporter}"`);
    const root = deps.cwd();
    gitResult(deps, root, ["rev-parse", "--is-inside-work-tree"]);
    const mergeBase = resolveMergeBase(deps, root, values.base);
    const changedFiles = gitResult(deps, root, ["diff", "--name-only", mergeBase]).split("\n");
    const files = changedFiles.filter(
      (file) => file === "package.json" || file.endsWith("/package.json"),
    );
    const configPath = join(root, "warden.config.json");
    const failOn = deps.exists(configPath)
      ? (jsonFile<{ ci?: { failOn?: string } }>(deps, configPath).ci?.failOn ?? "block")
      : "block";
    const allowedExceptions = deps.exists(configPath)
      ? (jsonFile<{ ci?: { allowExceptions?: string[] } }>(deps, configPath).ci?.allowExceptions ??
        [])
      : [];
    if (!["block", "warn"].includes(failOn)) throw new Error(`invalid ci.failOn "${failOn}"`);
    const work: { name: string; version: string; file: string; line?: number }[] = [];
    for (const file of files) {
      const currentRaw = deps.readFile(join(root, file));
      const current = dependencyMap(JSON.parse(currentRaw) as PackageJson);
      const baseResult = deps.git(["show", `${mergeBase}:${file}`], root);
      const previous =
        baseResult.exitCode === 0
          ? dependencyMap(JSON.parse(baseResult.stdout) as PackageJson)
          : {};
      for (const [name, version] of Object.entries(current)) {
        if (previous[name] === version) continue;
        const line = currentRaw.split("\n").findIndex((value) => value.includes(`"${name}"`)) + 1;
        work.push({ name, version, file, ...(line ? { line } : {}) });
      }
    }
    progressStep(`vetting ${work.length} changed dependencies`);
    let vetted = 0;
    const findings: CiFinding[] = (
      await Promise.all(
        work.map(async (item) => {
          const verdict = await deps.check(`${item.name}@${item.version}`);
          progressCount(++vetted, work.length);
          if (verdict.verdict === "allow") return null;
          const level = failOn === "warn" && verdict.verdict === "warn" ? "block" : verdict.verdict;
          return findingFor(verdict, item.file, item.line, level);
        }),
      )
    ).filter((finding): finding is CiFinding => finding !== null);
    for (const trigger of SURFACE_TRIGGERS) {
      if (!changedFiles.some((file) => trigger.matches(file))) continue;
      progressStep(`auditing the ${trigger.surface} surface`);
      const report = runSurfaceAudit(trigger.surface, root, deps);
      for (const item of report.findings)
        if (item.level !== "allow") findings.push(surfaceFinding(item, failOn));
    }
    if (values["require-transaction-receipt"]) {
      const graphFiles = changedFiles.filter(
        (file) => file === "package.json" || LOCKFILES.some((lock) => file.endsWith(lock)),
      );
      if (graphFiles.length)
        findings.push(...receiptFindings(root, deps, graphFiles, allowedExceptions));
    }
    const promptPath = join(root, ".warden", "prompt.txt");
    const intentPrompt =
      values["intent-prompt"] ??
      (deps.exists(promptPath) ? deps.readFile(promptPath).trim() : undefined);
    const runsIntent =
      Boolean(intentPrompt) && changedFiles.some((file) => /\.[cm]?[jt]sx?$/.test(file));
    if (runsIntent) progressStep("checking the diff against the prompt");
    const intent: IntentReport | undefined = runsIntent
      ? (await runIntentPipeline(deps, root, mergeBase, intentPrompt as string)).report
      : undefined;
    const guardLevel = findings.some((finding) => finding.level === "block")
      ? "block"
      : findings.some((finding) => finding.level === "warn")
        ? "warn"
        : "allow";
    const rank = { allow: 0, warn: 1, block: 2 } as const;
    const level = intent && rank[intent.verdict] > rank[guardLevel] ? intent.verdict : guardLevel;
    const exit = exitCodeFor(level);
    deps.mkdir(join(root, ".warden"));
    deps.writeFile(
      join(root, ".warden", "last-run.json"),
      `${JSON.stringify(
        {
          schema_version: SCHEMA_VERSION,
          findings,
          ...(intent ? { intent } : {}),
          verdict: level,
          exit,
        },
        null,
        2,
      )}\n`,
    );
    if (values.reporter === "json") deps.stdout(`${JSON.stringify(findings)}\n`);
    else if (values.reporter === "sarif")
      deps.stdout(
        `${JSON.stringify(toSarif(findings, "https://warden.pulkit.page/docs/ci"), null, 2)}\n`,
      );
    else if (values.reporter === "agent")
      deps.stdout(
        `${JSON.stringify({ findings, ...(intent ? { intent } : {}), verdict: level, exit })}\n`,
      );
    else {
      if (!isQuiet()) {
        deps.stderr(ciSummary(findings, mergeBase.slice(0, 12), work.length));
        if (intent) deps.stderr(`  intent  ${intentSummaryLine(intent)}\n`);
      }
      if (values.reporter === "github") {
        for (const finding of findings) {
          const command = finding.level === "block" ? "error" : "warning";
          deps.stdout(
            `::${command} file=${annotationValue(finding.file)}${finding.line ? `,line=${finding.line}` : ""}::${annotationValue(`${finding.package}: ${finding.evidence}. Fix: ${finding.fix}`)}\n`,
          );
        }
        for (const row of intent?.claims ?? []) {
          if (row.verdict !== "dropped") continue;
          deps.stdout(
            `::error ::${annotationValue(`intent: dropped requirement: ${row.claim}`)}\n`,
          );
        }
        for (const finding of intent?.hallucinations ?? []) {
          deps.stdout(
            `::error file=${annotationValue(finding.file)},line=${finding.line}::${annotationValue(`intent: hallucinated api ${finding.symbol}. ${finding.proof}`)}\n`,
          );
        }
        for (const finding of intent?.dependencies ?? []) {
          const command = finding.level === "block" ? "error" : "warning";
          deps.stdout(
            `::${command} file=${annotationValue(finding.file)},line=${finding.line}::${annotationValue(`intent: ${finding.rule} ${finding.package}. ${finding.proof} Fix: ${finding.fix}`)}\n`,
          );
        }
      }
    }
    return exit;
  } catch (error) {
    return wardenFailure(
      deps,
      jsonReporter,
      "analysis",
      "WARDEN_CI_ERROR",
      (error as Error).message,
      "verify git, the merge base, and package.json files",
    );
  }
}
