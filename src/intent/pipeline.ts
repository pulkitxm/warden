import { join } from "node:path";
import { gitResult } from "../shared/git.ts";
import { classifyHunks, parseUnifiedDiff, symbolScanFiles } from "./diff.ts";
import { extractClaims } from "./extract.ts";
import { intentLlmStats } from "./llm.ts";
import { decide, keywordPass, llmPass } from "./match.ts";
import { findHallucinations } from "./symbols.ts";
import type {
  ClassifiedHunk,
  FileDiff,
  HallucinationFinding,
  IntentLedger,
  IntentLlm,
  IntentPipelineDeps,
  IntentReport,
} from "./types.ts";

export const liveIntentLlm: IntentLlm = { extract: extractClaims, match: llmPass };

export interface DiffContext {
  root: string;
  mergeBase: string;
  diffs: FileDiff[];
  hunks: ClassifiedHunk[];
}

function untrackedDiffText(deps: IntentPipelineDeps, root: string): string {
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

export function collectFileDiffs(
  deps: IntentPipelineDeps,
  root: string,
  mergeBase: string,
): FileDiff[] {
  const tracked = gitResult(deps, root, ["diff", mergeBase]);
  const untracked = untrackedDiffText(deps, root);
  return parseUnifiedDiff(untracked === "" ? tracked : `${tracked}\n${untracked}`);
}

export function scanHallucinations(
  context: DiffContext,
  deps: IntentPipelineDeps,
): HallucinationFinding[] {
  const files = symbolScanFiles(context.diffs, (path) => deps.readFile(join(context.root, path)));
  return findHallucinations(files, context.root, { readFile: deps.readFile });
}

export interface IntentRun {
  ledger: IntentLedger;
  report: IntentReport;
}

export async function runIntentPipeline(
  deps: IntentPipelineDeps,
  root: string,
  mergeBase: string,
  prompt: string,
  llm: IntentLlm = liveIntentLlm,
): Promise<IntentRun> {
  const diffs = collectFileDiffs(deps, root, mergeBase);
  const hunks = classifyHunks(diffs, (path) => deps.readFile(join(root, path)));
  const context: DiffContext = { root, mergeBase, diffs, hunks };
  const hallucinations = scanHallucinations(context, deps);
  const before = intentLlmStats.calls;
  let ledger: IntentLedger;
  try {
    ledger = await llm.extract(prompt);
  } catch (error) {
    return {
      ledger: { schema_version: 1, source: "prompt", source_text: prompt, claims: [] },
      report: decide({
        prompt,
        base: mergeBase,
        claims: [],
        hunks,
        proposals: [],
        hallucinations,
        llmMatchFailed: false,
        llmCalls: { extract_calls: intentLlmStats.calls - before, match_calls: 0 },
        claimsStatus: "unverifiable",
        notes: [
          `claims not verifiable: ${(error as Error).message}`,
          `deterministic checks still ran: ${hunks.length} hunk(s) classified, ${hallucinations.length} hallucinated api(s) found`,
        ],
      }),
    };
  }
  const keyword = keywordPass(ledger.claims, hunks);
  const matchedClaims = new Set(keyword.map((proposal) => proposal.claimId));
  const leftovers = ledger.claims.filter(
    (claim) => claim.kind !== "preservation" && !matchedClaims.has(claim.id),
  );
  const afterExtract = intentLlmStats.calls;
  const matched = await llm.match(leftovers, hunks);
  const report = decide({
    prompt,
    base: mergeBase,
    claims: ledger.claims,
    hunks,
    proposals: [...keyword, ...matched.proposals],
    hallucinations,
    llmMatchFailed: matched.failed,
    llmCalls: {
      extract_calls: afterExtract - before,
      match_calls: intentLlmStats.calls - afterExtract,
    },
    notes: matched.failed
      ? [`${leftovers.length} claim(s) could not be matched: the match call failed`]
      : [],
  });
  return { ledger, report };
}
