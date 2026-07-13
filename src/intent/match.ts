import { type Evidence, exitCodeFor, type VerdictLevel } from "../schema.ts";
import { completeJson } from "./llm.ts";
import type {
  ClaimRow,
  ClaimStatus,
  ClassifiedHunk,
  HallucinationFinding,
  IntentClaim,
  IntentReport,
  MatchProposal,
  ScopeCreepRow,
} from "./types.ts";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "are",
  "was",
  "were",
  "add",
  "make",
  "sure",
  "keep",
  "use",
  "every",
  "all",
  "should",
  "must",
  "when",
  "from",
  "into",
  "new",
  "ensure",
  "code",
]);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const expanded = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const tokens = expanded
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .map(stem);
  return [...new Set(tokens)];
}

export interface KeywordScore {
  score: number;
  symbolHits: number;
  coverage: number;
}

export function keywordScore(claim: IntentClaim, hunk: ClassifiedHunk): KeywordScore {
  const claimTokens = new Set([
    ...tokenize(claim.claim),
    ...claim.keywords.flatMap((keyword) => tokenize(keyword)),
  ]);
  const symbolTokens = new Set(hunk.symbols.flatMap((symbol) => tokenize(symbol)));
  const textTokens = new Set(tokenize(`${hunk.summary} ${hunk.file}`));
  let score = 0;
  let symbolHits = 0;
  let hits = 0;
  for (const token of claimTokens) {
    if (symbolTokens.has(token)) {
      score += 2;
      symbolHits++;
      hits++;
    } else if (textTokens.has(token)) {
      score += 1;
      hits++;
    }
  }
  return { score, symbolHits, coverage: claimTokens.size ? hits / claimTokens.size : 0 };
}

function keywordMatches(claim: IntentClaim, hunk: ClassifiedHunk): boolean {
  const { score, symbolHits, coverage } = keywordScore(claim, hunk);
  return score >= 3 && symbolHits >= 1 && coverage >= 0.6;
}

function preservationTouches(claim: IntentClaim, hunk: ClassifiedHunk): boolean {
  if (keywordScore(claim, hunk).symbolHits >= 1) return true;
  const claimTokens = new Set([
    ...tokenize(claim.claim),
    ...claim.keywords.flatMap((keyword) => tokenize(keyword)),
  ]);
  return tokenize(hunk.file).some((token) => claimTokens.has(token));
}

export function keywordPass(claims: IntentClaim[], hunks: ClassifiedHunk[]): MatchProposal[] {
  const proposals: MatchProposal[] = [];
  for (const claim of claims) {
    if (claim.kind === "preservation") continue;
    const hunkIds = hunks.filter((hunk) => keywordMatches(claim, hunk)).map((hunk) => hunk.id);
    if (hunkIds.length) {
      proposals.push({ claimId: claim.id, hunkIds, status: "delivered", origin: "keyword" });
    }
  }
  return proposals;
}

const STATUSES = ["delivered", "partial", "dropped"];

export function proposalsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim_id", "hunk_ids", "status"],
          properties: {
            claim_id: { type: "string" },
            hunk_ids: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: STATUSES },
          },
        },
      },
    },
  };
}

export function parseProposals(
  value: unknown,
  claimIds: Set<string>,
  hunkIds: Set<string>,
): MatchProposal[] | null {
  if (typeof value !== "object" || value === null) return null;
  const matches = (value as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return null;
  const out: MatchProposal[] = [];
  for (const entry of matches) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.claim_id !== "string" || !claimIds.has(record.claim_id)) continue;
    if (!Array.isArray(record.hunk_ids) || !STATUSES.includes(String(record.status))) continue;
    out.push({
      claimId: record.claim_id,
      hunkIds: record.hunk_ids.filter(
        (id): id is string => typeof id === "string" && hunkIds.has(id),
      ),
      status: record.status as ClaimStatus,
      origin: "llm",
    });
  }
  return out;
}

const MATCH_SYSTEM = [
  "You match requirement claims to code-change hunks. For each claim decide delivered",
  "(the cited hunks implement it), partial (some evidence but incomplete), or dropped",
  "(no hunk implements it). Cite only hunk ids from the provided list. Judge only from",
  "the summaries and excerpts provided; never assume unlisted changes exist.",
].join(" ");

export async function llmPass(
  claims: IntentClaim[],
  hunks: ClassifiedHunk[],
): Promise<{ proposals: MatchProposal[]; failed: boolean }> {
  if (!claims.length) return { proposals: [], failed: false };
  const user = JSON.stringify({
    claims: claims.map(({ id, claim }) => ({ id, claim })),
    hunks: hunks.map(({ id, file, summary, symbols, excerpt }) => ({
      id,
      file,
      summary,
      symbols,
      excerpt,
    })),
  });
  try {
    const proposals = await completeJson(
      { system: MATCH_SYSTEM, user, schemaName: "claim_matches", schema: proposalsSchema() },
      (value) =>
        parseProposals(
          value,
          new Set(claims.map((claim) => claim.id)),
          new Set(hunks.map((hunk) => hunk.id)),
        ),
    );
    return { proposals, failed: false };
  } catch {
    return { proposals: [], failed: true };
  }
}

export interface DecideInput {
  prompt: string;
  base: string;
  claims: IntentClaim[];
  hunks: ClassifiedHunk[];
  proposals: MatchProposal[];
  hallucinations: HallucinationFinding[];
  llmMatchFailed: boolean;
  llmCalls: { extract_calls: number; match_calls: number };
}

function hunkRef(hunk: ClassifiedHunk): string {
  return `${hunk.file}:${hunk.lineStart}-${hunk.lineEnd}`;
}

function claimRow(
  claim: IntentClaim,
  verdict: ClaimStatus,
  hunkRefs: string[],
  evidence: Evidence[],
  origin: ClaimRow["origin"],
): ClaimRow {
  return {
    claim_id: claim.id,
    claim: claim.claim,
    kind: claim.kind,
    verdict,
    hunk_refs: hunkRefs,
    evidence,
    origin,
  };
}

export function decide(input: DecideInput): IntentReport {
  const hunkById = new Map(input.hunks.map((hunk) => [hunk.id, hunk]));
  const rows: ClaimRow[] = [];
  const cited = new Set<string>();

  for (const claim of input.claims) {
    if (claim.kind === "preservation") {
      const touching = input.hunks.filter((hunk) => preservationTouches(claim, hunk));
      if (!touching.length) {
        rows.push(
          claimRow(
            claim,
            "delivered",
            [],
            [{ file: "-", detail: "no change touches it" }],
            "preservation",
          ),
        );
      } else {
        for (const hunk of touching) cited.add(hunk.id);
        rows.push(
          claimRow(
            claim,
            "dropped",
            touching.map(hunkRef),
            touching.map((hunk) => ({
              file: hunk.file,
              line: hunk.lineStart,
              detail: `asked to preserve, but ${hunk.summary}`,
            })),
            "preservation",
          ),
        );
      }
      continue;
    }
    const proposal =
      input.proposals.find(
        (candidate) => candidate.origin === "keyword" && candidate.claimId === claim.id,
      ) ??
      input.proposals.find(
        (candidate) => candidate.origin === "llm" && candidate.claimId === claim.id,
      );
    if (proposal) {
      const validHunks = proposal.hunkIds
        .map((id) => hunkById.get(id))
        .filter((hunk): hunk is ClassifiedHunk => Boolean(hunk));
      for (const hunk of validHunks) cited.add(hunk.id);
      if (proposal.status === "dropped") {
        rows.push(
          claimRow(
            claim,
            "dropped",
            [],
            [{ file: "-", detail: "no matching change found" }],
            proposal.origin,
          ),
        );
      } else if (!validHunks.length) {
        rows.push(
          claimRow(
            claim,
            "partial",
            [],
            [{ file: "-", detail: "llm asserted without evidence" }],
            proposal.origin,
          ),
        );
      } else {
        rows.push(
          claimRow(
            claim,
            proposal.status,
            validHunks.map(hunkRef),
            validHunks.map((hunk) => ({
              file: hunk.file,
              line: hunk.lineStart,
              detail: hunk.summary,
            })),
            proposal.origin,
          ),
        );
      }
    } else if (input.llmMatchFailed) {
      rows.push(
        claimRow(
          claim,
          "partial",
          [],
          [{ file: "-", detail: "not verifiable: match llm unavailable" }],
          "none",
        ),
      );
    } else {
      rows.push(
        claimRow(claim, "dropped", [], [{ file: "-", detail: "no matching change found" }], "none"),
      );
    }
  }

  const scopeCreep: ScopeCreepRow[] = input.hunks
    .filter(
      (hunk) =>
        !cited.has(hunk.id) &&
        !["formatting_only", "test_or_doc"].includes(hunk.category) &&
        hunk.addedLines >= 5,
    )
    .sort((a, b) => b.addedLines - a.addedLines)
    .map((hunk) => ({
      hunk_id: hunk.id,
      file: hunk.file,
      line_start: hunk.lineStart,
      line_end: hunk.lineEnd,
      added_lines: hunk.addedLines,
      summary: hunk.summary,
    }));

  const dropped = rows.some((row) => row.verdict === "dropped");
  const partial = rows.some((row) => row.verdict === "partial");
  const level: VerdictLevel =
    dropped || input.hallucinations.length > 0
      ? "block"
      : partial || scopeCreep.length > 0
        ? "warn"
        : "allow";
  return {
    schema_version: 1,
    source: "prompt",
    prompt: input.prompt,
    base: input.base,
    claims: rows,
    scope_creep: scopeCreep,
    hallucinations: input.hallucinations,
    verdict: level,
    exit: exitCodeFor(level),
    llm: input.llmCalls,
  };
}
