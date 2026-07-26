import type { VerdictLevel } from "../../schema.ts";
import { parseProposals } from "../match.ts";
import { liveIntentLlm, runIntentPipeline } from "../pipeline.ts";
import type {
  ClaimStatus,
  IntentLlm,
  IntentPipelineDeps,
  IntentReport,
  MatchProposal,
} from "../types.ts";
import type { CorpusCase } from "./cases.ts";
import { corpusDiffText } from "./diff.ts";

export const CORPUS_ROOT = "/intent-corpus";

export const FALSE_POSITIVE_BUDGET = 0.05;

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(`${CORPUS_ROOT}/`, "");
}

export function corpusFiles(entry: CorpusCase): Map<string, string> {
  const files = new Map<string, string>();
  for (const change of entry.changes) {
    if (change.after !== undefined) files.set(change.path, change.after);
  }
  if (entry.manifest) files.set("package.json", JSON.stringify(entry.manifest, null, 2));
  for (const [path, content] of Object.entries(entry.nodeModules ?? {})) {
    files.set(`node_modules/${path}`, content);
  }
  return files;
}

export function corpusDeps(entry: CorpusCase): IntentPipelineDeps {
  const files = corpusFiles(entry);
  const diff = corpusDiffText(entry.changes);
  return {
    git: (args: string[]) => {
      if (args[0] === "diff") return { exitCode: 0, stdout: diff, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    readFile: (path: string) => {
      const content = files.get(normalize(path));
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    },
  };
}

export function replayLlm(entry: CorpusCase): IntentLlm {
  return {
    extract: (prompt: string) => {
      if (entry.extract === "unavailable") {
        return Promise.reject(new Error("no llm api key configured"));
      }
      return Promise.resolve({
        schema_version: 1 as const,
        source: "prompt" as const,
        source_text: prompt,
        claims: entry.extract.map((claim, index) => ({ ...claim, id: `c${index + 1}` })),
      });
    },
    match: (claims, hunks) => {
      if (!claims.length || !hunks.length) {
        return Promise.resolve({ proposals: [] as MatchProposal[], failed: false });
      }
      if (entry.match === undefined || entry.match === "unavailable") {
        return Promise.resolve({ proposals: [] as MatchProposal[], failed: true });
      }
      const proposals = parseProposals(
        { matches: entry.match },
        new Set(claims.map((claim) => claim.id)),
        new Set(hunks.map((hunk) => hunk.id)),
      );
      return Promise.resolve({ proposals: proposals ?? [], failed: false });
    },
  };
}

export interface CaseResult {
  id: string;
  shape: string;
  kind: CorpusCase["kind"];
  expectedVerdict: VerdictLevel | "error";
  actualVerdict: VerdictLevel | "error";
  expectedClaims: ClaimStatus[] | "unpinned";
  actualClaims: ClaimStatus[];
  expectedScopeCreep: boolean;
  actualScopeCreep: boolean;
  expectedHallucinations: number;
  actualHallucinations: number;
  correct: boolean;
  knownGap: boolean;
}

export interface RuleScore {
  positives: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export interface CorpusReport {
  schema_version: 1;
  analyzer_version: string;
  totals: { cases: number; conforming: number; violating: number; degraded: number };
  verdicts: { correct: number; rate: number };
  falsePositives: { count: number; rate: number; budget: number; withinBudget: boolean };
  rules: Record<string, RuleScore>;
  results: CaseResult[];
  knownGaps: string[];
  staleGaps: string[];
  method: string[];
}

interface Counts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  positives: number;
}

function emptyCounts(): Counts {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0, positives: 0 };
}

function tally(counts: Counts, expected: boolean, actual: boolean): void {
  if (expected) counts.positives++;
  if (expected && actual) counts.truePositives++;
  else if (!expected && actual) counts.falsePositives++;
  else if (expected && !actual) counts.falseNegatives++;
}

function score(counts: Counts): RuleScore {
  const predicted = counts.truePositives + counts.falsePositives;
  return {
    positives: counts.positives,
    truePositives: counts.truePositives,
    falsePositives: counts.falsePositives,
    falseNegatives: counts.falseNegatives,
    precision: predicted ? counts.truePositives / predicted : 1,
    recall: counts.positives ? counts.truePositives / counts.positives : 1,
  };
}

export const KNOWN_GAPS: Record<string, string> = {
  "legitimate-wide-refactor":
    "the match call called a fully delivered extraction partial, and one llm sample has no backstop",
  "inline-simplification":
    "the match call called a delivered simplification dropped, and one llm sample has no backstop",
  "contradictory-prompt":
    "a preservation claim the prompt itself contradicts is reported dropped, where abstaining is the honest answer",
};

export async function runCorpusCase(entry: CorpusCase, llm?: IntentLlm): Promise<CaseResult> {
  let report: IntentReport | null = null;
  try {
    const run = await runIntentPipeline(
      corpusDeps(entry),
      CORPUS_ROOT,
      "corpusbase",
      entry.prompt,
      llm ?? replayLlm(entry),
    );
    report = run.report;
  } catch {
    report = null;
  }
  const actualClaims = report?.claims.map((row) => row.verdict) ?? [];
  const actualVerdict: VerdictLevel | "error" = report?.verdict ?? "error";
  const actualScopeCreep = (report?.scope_creep.length ?? 0) > 0;
  const actualHallucinations = report?.hallucinations.length ?? 0;
  const claimsMatch =
    entry.expected.claims === "unpinned" ||
    JSON.stringify(actualClaims) === JSON.stringify(entry.expected.claims);
  const correct =
    actualVerdict === entry.expected.verdict &&
    actualScopeCreep === entry.expected.scopeCreep &&
    actualHallucinations === entry.expected.hallucinations &&
    claimsMatch;
  return {
    id: entry.id,
    shape: entry.shape,
    kind: entry.kind,
    expectedVerdict: entry.expected.verdict,
    actualVerdict,
    expectedClaims: entry.expected.claims,
    actualClaims,
    expectedScopeCreep: entry.expected.scopeCreep,
    actualScopeCreep,
    expectedHallucinations: entry.expected.hallucinations,
    actualHallucinations,
    correct,
    knownGap: entry.id in KNOWN_GAPS,
  };
}

const STOPS: Array<VerdictLevel | "error"> = ["warn", "block", "error"];

export async function runCorpus(
  cases: CorpusCase[],
  analyzerVersion: string,
  llm?: IntentLlm,
): Promise<CorpusReport> {
  const results: CaseResult[] = [];
  for (const entry of cases) results.push(await runCorpusCase(entry, llm));

  const claimCounts = emptyCounts();
  const creepCounts = emptyCounts();
  const hallucinationCounts = emptyCounts();
  for (const result of results) {
    const expectedClaims = result.expectedClaims;
    if (expectedClaims !== "unpinned") {
      const claimSlots = Math.max(expectedClaims.length, result.actualClaims.length);
      for (let index = 0; index < claimSlots; index++) {
        tally(
          claimCounts,
          expectedClaims[index] === "dropped",
          result.actualClaims[index] === "dropped",
        );
      }
    }
    tally(creepCounts, result.expectedScopeCreep, result.actualScopeCreep);
    tally(
      hallucinationCounts,
      result.expectedHallucinations > 0,
      result.actualHallucinations > 0,
    );
  }

  const conforming = results.filter((result) => result.kind === "conforming");
  const violating = results.filter((result) => result.kind === "violating");
  const stopped = conforming.filter((result) => STOPS.includes(result.actualVerdict));
  const correct = results.filter((result) => result.correct);
  const falsePositiveRate = conforming.length ? stopped.length / conforming.length : 0;

  return {
    schema_version: 1,
    analyzer_version: analyzerVersion,
    totals: {
      cases: results.length,
      conforming: conforming.length,
      violating: violating.length,
      degraded: results.filter((result) => result.kind === "degraded").length,
    },
    verdicts: {
      correct: correct.length,
      rate: results.length ? correct.length / results.length : 1,
    },
    falsePositives: {
      count: stopped.length,
      rate: falsePositiveRate,
      budget: FALSE_POSITIVE_BUDGET,
      withinBudget: falsePositiveRate <= FALSE_POSITIVE_BUDGET,
    },
    rules: {
      claim_matching: score(claimCounts),
      scope_creep: score(creepCounts),
      hallucination: score(hallucinationCounts),
    },
    results,
    knownGaps: results.filter((result) => result.knownGap && !result.correct).map((r) => r.id),
    staleGaps: results.filter((result) => result.knownGap && result.correct).map((r) => r.id),
    method: [
      "every case runs through the same pipeline the cli uses, with the llm replaced by a recorded response",
      "diffs are synthesized from before and after file images by an lcs differ that matches git's hunk boundaries",
      "a conforming case counts as a false positive when the verdict is anything other than allow",
      "a degraded case exercises behaviour when a provider is unavailable, so it is scored for correctness but kept out of the false-positive denominator",
      "claim matching is scored on detecting a dropped claim, which is the outcome that blocks",
      "scope creep and hallucination are scored per case on whether the rule fired at all, not per hunk",
      "cases listed as known gaps are counted as failures in these figures, not excluded from them",
      "these are curated shapes, not a sample of real pull requests; read the rates as regression signals",
    ],
  };
}

export function liveCorpusLlm(): IntentLlm {
  return liveIntentLlm;
}
