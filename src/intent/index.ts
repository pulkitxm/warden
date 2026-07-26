import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolvePackage } from "../registry.ts";
import { ANALYZER_VERSION, EXIT, INTENT_JSON_SCHEMA } from "../schema.ts";
import type { WardenDeps } from "../shared/deps.ts";
import { wardenFailure } from "../shared/errors.ts";
import { gitResult, resolveMergeBase } from "../shared/git.ts";
import { CORPUS_CASES } from "./corpus/cases.ts";
import { renderCorpus } from "./corpus/report.ts";
import { liveCorpusLlm, runCorpus } from "./corpus/run.ts";
import { classifyHunks } from "./diff.ts";
import { extractClaims } from "./extract.ts";
import {
  collectFileDiffs,
  type DiffContext,
  type IntentRun,
  runIntentPipeline,
  scanHallucinations,
} from "./pipeline.ts";
import { renderIntentReport } from "./report.ts";
import type { ClassifiedHunk, HallucinationFinding, IntentLedger, PackageExists } from "./types.ts";

export type { IntentRun } from "./pipeline.ts";
export { liveIntentLlm, runIntentPipeline } from "./pipeline.ts";

export interface IntentFlags {
  verb: string;
  prompt?: string;
  base?: string;
  json: boolean;
  offline: boolean;
}

export function parseIntentArgs(argv: string[]): IntentFlags {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      base: { type: "string" },
      json: { type: "boolean" },
      offline: { type: "boolean" },
    },
    allowPositionals: true,
  });
  return {
    verb: positionals[0] ?? "check",
    prompt: values.prompt,
    base: values.base,
    json: Boolean(values.json),
    offline: Boolean(values.offline),
  };
}

export const registryPackageExists: PackageExists = async (name: string) => {
  try {
    return (await resolvePackage(name)).existsOnRegistry;
  } catch {
    return null;
  }
};

function runIntentSchema(_flags: IntentFlags, deps: WardenDeps): number {
  deps.stdout(`${JSON.stringify(INTENT_JSON_SCHEMA, null, 2)}\n`);
  return EXIT.allow;
}

function renderLedger(ledger: IntentLedger): string {
  const rows = ledger.claims.map((claim) => `  ${claim.id}  [${claim.kind}]  ${claim.claim}`);
  return `intent claims (${ledger.claims.length}):\n${rows.join("\n")}\n`;
}

function writeWarden(deps: WardenDeps, root: string, name: string, value: unknown): void {
  deps.mkdir(join(root, ".warden"));
  deps.writeFile(join(root, ".warden", name), `${JSON.stringify(value, null, 2)}\n`);
}

function promptFromFile(deps: WardenDeps, root: string): string | undefined {
  try {
    return deps.readFile(join(root, ".warden", "prompt.txt")).trim() || undefined;
  } catch {
    return undefined;
  }
}

function missingPrompt(deps: WardenDeps, json: boolean): number {
  return wardenFailure(
    deps,
    json,
    "usage",
    "WARDEN_INTENT_ERROR",
    "no prompt provided",
    'pass --prompt "<text>" or write .warden/prompt.txt',
  );
}

async function runIntentExtract(flags: IntentFlags, deps: WardenDeps): Promise<number> {
  const prompt = flags.prompt?.trim();
  if (!prompt) return missingPrompt(deps, flags.json);
  const ledger = await extractClaims(prompt);
  writeWarden(deps, deps.cwd(), "claims.json", ledger);
  deps.stderr(renderLedger(ledger));
  if (flags.json) deps.stdout(`${JSON.stringify(ledger)}\n`);
  return EXIT.allow;
}

function collectDiff(flags: IntentFlags, deps: WardenDeps): DiffContext {
  const root = deps.cwd();
  gitResult(deps, root, ["rev-parse", "--is-inside-work-tree"]);
  const mergeBase = resolveMergeBase(deps, root, flags.base);
  const diffs = collectFileDiffs(deps, root, mergeBase);
  const hunks = classifyHunks(diffs, (path) => deps.readFile(join(root, path)));
  return { root, mergeBase, diffs, hunks };
}

function renderHunks(hunks: ClassifiedHunk[]): string {
  if (!hunks.length) return "no hunks in the diff\n";
  const rows = hunks.map(
    (hunk) =>
      `  ${hunk.id}  ${hunk.file}:${hunk.lineStart}-${hunk.lineEnd}  ${hunk.category}  ${hunk.symbols.join(", ")}`,
  );
  return `classified hunks (${hunks.length}):\n${rows.join("\n")}\n`;
}

function runIntentDiff(flags: IntentFlags, deps: WardenDeps): number {
  const context = collectDiff(flags, deps);
  if (flags.json) deps.stdout(`${JSON.stringify(context.hunks)}\n`);
  deps.stderr(renderHunks(context.hunks));
  return EXIT.allow;
}

function renderFindings(findings: HallucinationFinding[]): string {
  if (!findings.length) return "no hallucinated apis found\n";
  const rows = findings.map(
    (finding) => `  🚨 ${finding.file}:${finding.line}  ${finding.symbol}\n     ${finding.proof}`,
  );
  return `hallucinated apis (${findings.length}):\n${rows.join("\n")}\n`;
}

function runIntentSymbols(flags: IntentFlags, deps: WardenDeps): number {
  const context = collectDiff(flags, deps);
  const findings = scanHallucinations(context, deps);
  if (flags.json) deps.stdout(`${JSON.stringify(findings)}\n`);
  deps.stderr(renderFindings(findings));
  return findings.length ? EXIT.block : EXIT.allow;
}

async function runIntentBench(flags: IntentFlags, deps: WardenDeps): Promise<number> {
  const live = process.env.WARDEN_INTENT_CORPUS_LIVE === "1";
  const report = await runCorpus(
    CORPUS_CASES,
    ANALYZER_VERSION,
    live ? liveCorpusLlm() : undefined,
  );
  if (flags.json) deps.stdout(`${JSON.stringify(report, null, 2)}\n`);
  deps.stderr(renderCorpus(report));
  const regressed = report.results.some((result) => !result.correct && !result.knownGap);
  return regressed || report.staleGaps.length ? EXIT.block : EXIT.allow;
}

async function runIntentCheck(flags: IntentFlags, deps: WardenDeps): Promise<number> {
  const root = deps.cwd();
  const prompt = flags.prompt?.trim() || promptFromFile(deps, root);
  if (!prompt) return missingPrompt(deps, flags.json);
  gitResult(deps, root, ["rev-parse", "--is-inside-work-tree"]);
  const mergeBase = resolveMergeBase(deps, root, flags.base);
  const { ledger, report }: IntentRun = await runIntentPipeline(
    deps,
    root,
    mergeBase,
    prompt,
    undefined,
    flags.offline ? undefined : registryPackageExists,
  );
  deps.stderr(renderLedger(ledger));
  writeWarden(deps, root, "claims.json", ledger);
  writeWarden(deps, root, "intent-report.json", report);
  if (flags.json) deps.stdout(`${JSON.stringify(report)}\n`);
  deps.stderr(renderIntentReport(report));
  return report.exit;
}

const INTENT_VERBS: Record<
  string,
  (flags: IntentFlags, deps: WardenDeps) => number | Promise<number>
> = {
  schema: runIntentSchema,
  extract: runIntentExtract,
  diff: runIntentDiff,
  symbols: runIntentSymbols,
  bench: runIntentBench,
  check: runIntentCheck,
};

export async function runWardenIntent(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  try {
    const flags = parseIntentArgs(argv);
    const handler = INTENT_VERBS[flags.verb];
    if (!handler) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_INTENT_ERROR",
        `unknown intent verb "${flags.verb}"`,
        "run warden intent --help",
      );
    }
    return await handler(flags, deps);
  } catch (error) {
    const message = cleanErrorMessage((error as Error).message);
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_INTENT_ERROR",
      message,
      hintFor(message),
    );
  }
}

function cleanErrorMessage(message: string): string {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Stopping at filesystem boundary"))
    .join(" ");
}

const LLM_HINT =
  "check your llm setup (WNPM_LLM_PROVIDER=claude or codex, or GROQ_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY)";

function hintFor(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("git repository") ||
    lower.includes("not a valid object") ||
    lower.includes("merge-base") ||
    lower.includes("main is available") ||
    lower.includes("ambiguous argument") ||
    lower.includes("unknown revision")
  ) {
    return "run inside a git repo whose base ref exists (set --base to a real branch or commit)";
  }
  return LLM_HINT;
}
