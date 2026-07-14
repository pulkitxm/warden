import { join } from "node:path";
import { parseArgs } from "node:util";
import { gitResult, resolveMergeBase, type WardenDeps, wardenFailure } from "../cli/main.ts";
import { EXIT, INTENT_JSON_SCHEMA } from "../schema.ts";
import { classifyHunks, parseUnifiedDiff, symbolScanFiles } from "./diff.ts";
import { extractClaims } from "./extract.ts";
import { decide, keywordPass, llmPass } from "./match.ts";
import { renderIntentReport } from "./report.ts";
import { findHallucinations } from "./symbols.ts";
import type {
  ClassifiedHunk,
  FileDiff,
  HallucinationFinding,
  IntentLedger,
  IntentReport,
} from "./types.ts";

export interface IntentFlags {
  verb: string;
  prompt?: string;
  base?: string;
  json: boolean;
}

export function parseIntentArgs(argv: string[]): IntentFlags {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      base: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  return {
    verb: positionals[0] ?? "check",
    prompt: values.prompt,
    base: values.base,
    json: Boolean(values.json),
  };
}

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

interface DiffContext {
  root: string;
  mergeBase: string;
  diffs: FileDiff[];
  hunks: ClassifiedHunk[];
}

function untrackedDiffText(deps: WardenDeps, root: string): string {
  const result = deps.git(["ls-files", "--others", "--exclude-standard"], root);
  if (result.exitCode !== 0) return "";
  const sections: string[] = [];
  for (const raw of result.stdout.split("\n")) {
    const path = raw.trim();
    if (path === "" || path.startsWith(".warden/")) continue;
    if (path === "node_modules" || path.startsWith("node_modules/")) continue;
    if (path.includes("/node_modules/") || path.startsWith(".git/")) continue;
    let code: string;
    try {
      code = deps.readFile(join(root, path));
    } catch {
      continue;
    }
    if (code.includes("\u0000")) continue;
    const lines = code.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) continue;
    sections.push(
      [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
      ].join("\n"),
    );
  }
  return sections.join("\n");
}

function collectFileDiffs(deps: WardenDeps, root: string, mergeBase: string): FileDiff[] {
  const tracked = gitResult(deps, root, ["diff", mergeBase]);
  const untracked = untrackedDiffText(deps, root);
  return parseUnifiedDiff(untracked === "" ? tracked : `${tracked}\n${untracked}`);
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

function scanHallucinations(context: DiffContext, deps: WardenDeps): HallucinationFinding[] {
  const files = symbolScanFiles(context.diffs, (path) => deps.readFile(join(context.root, path)));
  return findHallucinations(files, context.root, { readFile: deps.readFile });
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

export interface IntentRun {
  ledger: IntentLedger;
  report: IntentReport;
}

export async function runIntentPipeline(
  deps: WardenDeps,
  root: string,
  mergeBase: string,
  prompt: string,
): Promise<IntentRun> {
  const diffs = collectFileDiffs(deps, root, mergeBase);
  const hunks = classifyHunks(diffs, (path) => deps.readFile(join(root, path)));
  const context: DiffContext = { root, mergeBase, diffs, hunks };
  const hallucinations = scanHallucinations(context, deps);
  let ledger: IntentLedger;
  try {
    ledger = await extractClaims(prompt);
  } catch (error) {
    const note = hallucinations.length
      ? ` (note: deterministic scan still found ${hallucinations.length} hallucinated api(s): ${hallucinations
          .map((finding) => finding.symbol)
          .join(", ")})`
      : "";
    throw new Error(`${(error as Error).message}${note}`);
  }
  const keyword = keywordPass(ledger.claims, hunks);
  const matchedClaims = new Set(keyword.map((proposal) => proposal.claimId));
  const leftovers = ledger.claims.filter(
    (claim) => claim.kind !== "preservation" && !matchedClaims.has(claim.id),
  );
  const llm = await llmPass(leftovers, hunks);
  const report = decide({
    prompt,
    base: mergeBase,
    claims: ledger.claims,
    hunks,
    proposals: [...keyword, ...llm.proposals],
    hallucinations,
    llmMatchFailed: llm.failed,
    llmCalls: { extract_calls: 1, match_calls: leftovers.length ? 1 : 0 },
  });
  return { ledger, report };
}

async function runIntentCheck(flags: IntentFlags, deps: WardenDeps): Promise<number> {
  const root = deps.cwd();
  const prompt = flags.prompt?.trim() || promptFromFile(deps, root);
  if (!prompt) return missingPrompt(deps, flags.json);
  gitResult(deps, root, ["rev-parse", "--is-inside-work-tree"]);
  const mergeBase = resolveMergeBase(deps, root, flags.base);
  const { ledger, report } = await runIntentPipeline(deps, root, mergeBase, prompt);
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
