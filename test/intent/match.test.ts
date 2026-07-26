import { afterEach, beforeEach, expect, test } from "bun:test";
import { intentLlmStats } from "../../src/intent/llm.ts";
import {
  type DecideInput,
  decide,
  keywordPass,
  keywordScore,
  llmPass,
  parseProposals,
  proposalsSchema,
  symbolNamedByClaim,
  tokenize,
} from "../../src/intent/match.ts";
import type {
  ClassifiedHunk,
  HallucinationFinding,
  IntentClaim,
  MatchProposal,
} from "../../src/intent/types.ts";

const ENV_KEYS = ["OPENAI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "WNPM_LLM_PROVIDER"];
const saved = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

function claim(id: string, text: string, over: Partial<IntentClaim> = {}): IntentClaim {
  return { id, claim: text, kind: "behavior", keywords: [], sourceText: text, ...over };
}

function hunk(id: string, over: Partial<ClassifiedHunk> = {}): ClassifiedHunk {
  const base: ClassifiedHunk = {
    id,
    file: "api-client.ts",
    lineStart: 1,
    lineEnd: 10,
    category: "new_function",
    summary: "new_function fetchPage",
    symbols: ["fetchPage"],
    changedSymbols: ["fetchPage"],
    imports: [],
    addedLines: 10,
    excerpt: "function fetchPage(url) {",
    removedExcerpt: "",
    ...over,
  };
  return { ...base, changedSymbols: over.changedSymbols ?? base.symbols };
}

test("tokenize splits camel case, stems, and drops stopwords", () => {
  expect(tokenize("add rateLimiting to the API client")).toEqual([
    "rate",
    "limit",
    "api",
    "client",
  ]);
  expect(tokenize("429s handled and retries logged")).toEqual(["429", "handl", "retrie", "logg"]);
  expect(tokenize("keep it")).toEqual([]);
});

test("keywordScore weights symbol hits double and counts them", () => {
  const rateClaim = claim("c1", "add rate limiting", { keywords: ["throttle"] });
  const rateHunk = hunk("h1", {
    symbols: ["applyRateLimit"],
    summary: "new_function applyRateLimit",
  });
  const scored = keywordScore(rateClaim, rateHunk);
  expect(scored.symbolHits).toBe(2);
  expect(scored.score).toBe(4);
  expect(scored.coverage).toBeCloseTo(2 / 3);
  const textOnly = keywordScore(claim("c2", "client changes"), hunk("h2", { symbols: [] }));
  expect(textOnly.symbolHits).toBe(0);
  expect(textOnly.score).toBe(1);
  expect(keywordScore(claim("c3", "of it"), hunk("h3")).coverage).toBe(0);
});

test("keywordPass proposes matches and leaves preservation claims alone", () => {
  const claims = [
    claim("c1", "add rate limiting to the client", { keywords: ["rate", "limit"] }),
    claim("c2", "keep the retry logic", { kind: "preservation", keywords: ["retry"] }),
    claim("c3", "log every rate limited request"),
  ];
  const hunks = [
    hunk("h1", { symbols: ["applyRateLimit"], summary: "new_function applyRateLimit" }),
    hunk("h2", { symbols: ["paginate"], summary: "other paginate", file: "pagination.ts" }),
  ];
  const proposals = keywordPass(claims, hunks);
  expect(proposals).toEqual([
    { claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "keyword" },
  ]);
});

test("proposalsSchema requires matches with claim, hunks, and status", () => {
  const schema = proposalsSchema() as {
    required: string[];
    properties: { matches: { items: { required: string[] } } };
  };
  expect(schema.required).toEqual(["matches"]);
  expect(schema.properties.matches.items.required).toEqual(["claim_id", "hunk_ids", "status"]);
});

test("parseProposals validates ids and filters junk without trusting the llm", () => {
  const claimIds = new Set(["c1", "c2"]);
  const hunkIds = new Set(["h1"]);
  expect(parseProposals(null, claimIds, hunkIds)).toBeNull();
  expect(parseProposals({}, claimIds, hunkIds)).toBeNull();
  expect(parseProposals({ matches: ["x"] }, claimIds, hunkIds)).toBeNull();
  const parsed = parseProposals(
    {
      matches: [
        { claim_id: "c1", hunk_ids: ["h1", "h9", 7], status: "delivered" },
        { claim_id: "ghost", hunk_ids: [], status: "dropped" },
        { claim_id: "c2", hunk_ids: "h1", status: "dropped" },
        { claim_id: "c2", hunk_ids: [], status: "maybe" },
        { claim_id: "c2", hunk_ids: [], status: "dropped" },
      ],
    },
    claimIds,
    hunkIds,
  );
  expect(parsed).toEqual([
    { claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "llm" },
    { claimId: "c2", hunkIds: [], status: "dropped", origin: "llm" },
  ]);
});

test("llmPass skips the call entirely when no claims remain", async () => {
  const before = intentLlmStats.calls;
  expect(await llmPass([], [hunk("h1")])).toEqual({ proposals: [], failed: false });
  expect(intentLlmStats.calls).toBe(before);
});

test("llmPass proposes matches from summaries only and degrades on failure", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [{ claim_id: "c1", hunk_ids: ["h1"], status: "delivered" }],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const result = await llmPass([claim("c1", "handle empty responses")], [hunk("h1")]);
  expect(result.failed).toBe(false);
  expect(result.proposals[0]).toMatchObject({ claimId: "c1", origin: "llm" });
  expect(bodies[0]).not.toContain("lineStart");

  globalThis.fetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  expect(await llmPass([claim("c1", "x y z")], [hunk("h1")])).toEqual({
    proposals: [],
    failed: true,
  });
});

function decideInput(over: Partial<DecideInput> = {}): DecideInput {
  return {
    prompt: "add rate limiting",
    base: "abc123",
    claims: [],
    hunks: [],
    proposals: [],
    hallucinations: [],
    llmMatchFailed: false,
    llmCalls: { extract_calls: 1, match_calls: 1 },
    ...over,
  };
}

const HALLUCINATION: HallucinationFinding = {
  symbol: "axios.instance.throttle",
  package: "axios",
  file: "api-client.ts",
  line: 4,
  proof: "axios instance has no member 'throttle'",
  source: "curated",
};

test("decide honors keyword proposals over llm proposals and cites hunks", () => {
  const proposals: MatchProposal[] = [
    { claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "keyword" },
    { claimId: "c1", hunkIds: [], status: "dropped", origin: "llm" },
  ];
  const report = decide(
    decideInput({ claims: [claim("c1", "add rate limiting")], hunks: [hunk("h1")], proposals }),
  );
  expect(report.claims[0]).toMatchObject({
    verdict: "delivered",
    origin: "keyword",
    hunk_refs: ["api-client.ts:1-10"],
  });
  expect(report.verdict).toBe("allow");
  expect(report.exit).toBe(0);
});

test("decide downgrades llm assertions without valid citations", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "handle empty responses")],
      hunks: [hunk("h1")],
      proposals: [{ claimId: "c1", hunkIds: ["ghost"], status: "delivered", origin: "llm" }],
    }),
  );
  expect(report.claims[0]).toMatchObject({ verdict: "partial", origin: "llm" });
  expect(report.claims[0]!.evidence[0]!.detail).toBe("llm asserted without evidence");
  expect(report.verdict).toBe("warn");
  expect(report.exit).toBe(10);
});

test("decide marks llm-dropped and unmatched claims as dropped", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "log every request"), claim("c2", "notify the auditor")],
      hunks: [hunk("h1")],
      proposals: [{ claimId: "c1", hunkIds: [], status: "dropped", origin: "llm" }],
    }),
  );
  expect(report.claims.map((row) => row.verdict)).toEqual(["dropped", "dropped"]);
  expect(report.claims.map((row) => row.origin)).toEqual(["llm", "none"]);
  expect(report.verdict).toBe("block");
  expect(report.exit).toBe(20);
});

test("decide degrades unmatched claims to partial when the match llm is down", () => {
  const report = decide(
    decideInput({ claims: [claim("c1", "log every request")], llmMatchFailed: true }),
  );
  expect(report.claims[0]).toMatchObject({ verdict: "partial", origin: "none" });
  expect(report.claims[0]!.evidence[0]!.detail).toBe("not verifiable: match llm unavailable");
  expect(report.verdict).toBe("warn");
});

test("a preservation claim nothing names is delivered, and says that is all it knows", () => {
  const kept = decide(
    decideInput({
      claims: [claim("c1", "keep the retry logic", { kind: "preservation", keywords: ["retry"] })],
      hunks: [hunk("h1", { symbols: ["paginate"], summary: "other paginate" })],
    }),
  );
  expect(kept.claims[0]).toMatchObject({ verdict: "delivered", origin: "preservation" });
  expect(kept.claims[0]!.evidence[0]!.detail).toBe("no change names it");
});

test("a preservation claim is dropped only when what it names is deleted and does not come back", () => {
  const violated = decide(
    decideInput({
      claims: [claim("c1", "keep the retry logic", { kind: "preservation", keywords: ["retry"] })],
      hunks: [
        hunk("h1", {
          file: "retry.ts",
          symbols: ["listItems"],
          changedSymbols: ["listItems"],
          summary: "deletion listItems",
          removedExcerpt: "export async function retryRequest(url) {",
        }),
      ],
      afterFile: () => "export async function listItems(url) { return fetch(url); }",
    }),
  );
  expect(violated.claims[0]).toMatchObject({ verdict: "dropped", origin: "preservation" });
  expect(violated.claims[0]!.evidence[0]!.detail).toContain("does not appear in retry.ts afterwards");
  expect(violated.verdict).toBe("block");
});

test("a symbol removed from one place but still present afterwards is not a dropped preservation", () => {
  const moved = decide(
    decideInput({
      claims: [claim("c1", "keep the retry logic", { kind: "preservation", keywords: ["retry"] })],
      hunks: [
        hunk("h1", {
          file: "retry.ts",
          symbols: ["retryRequest"],
          changedSymbols: [],
          summary: "other retryRequest",
          removedExcerpt: "  return retryRequest(url, 2);",
        }),
      ],
      afterFile: () => "export function retryRequest(url) {}",
    }),
  );
  expect(moved.claims[0]!.verdict).toBe("delivered");
});

test("a preservation claim changed only by a hunk a matched claim asked for is delivered", () => {
  const report = decide(
    decideInput({
      claims: [
        claim("c1", "extract validation out of createUser"),
        claim("c2", "keep creating the user", {
          kind: "preservation",
          keywords: ["createuser", "creation"],
        }),
      ],
      hunks: [
        hunk("h1", {
          file: "user.ts",
          symbols: ["createUser"],
          changedSymbols: ["createUser"],
          summary: "import_added createUser",
        }),
      ],
      proposals: [{ claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "llm" }],
      afterFile: () => "export function createUser(input) { validateInput(input); }",
    }),
  );
  expect(report.claims[1]).toMatchObject({ verdict: "delivered", origin: "preservation" });
  expect(report.claims[1]!.evidence[0]!.detail).toContain("which a matched claim asked for");
  expect(report.verdict).toBe("allow");
});

test("a preservation claim changed by a hunk nobody asked for is partial, not dropped", () => {
  const report = decide(
    decideInput({
      claims: [
        claim("c1", "keep the retry behaviour", { kind: "preservation", keywords: ["retry"] }),
      ],
      hunks: [
        hunk("h1", {
          file: "retry.ts",
          symbols: ["retryRequest"],
          changedSymbols: ["retryRequest"],
          summary: "conditional_changed retryRequest",
        }),
      ],
      afterFile: () => "export function retryRequest(url) {}",
    }),
  );
  expect(report.claims[0]).toMatchObject({ verdict: "partial", origin: "preservation" });
  expect(report.claims[0]!.evidence[0]!.detail).toContain("no claim asked for that");
  expect(report.verdict).toBe("warn");
});

test("a formatting-only hunk never fails a preservation claim", () => {
  const report = decide(
    decideInput({
      claims: [
        claim("c1", "do not change behaviour", {
          kind: "preservation",
          keywords: ["total", "average"],
        }),
      ],
      hunks: [
        hunk("h1", {
          file: "totals.ts",
          category: "formatting_only",
          symbols: ["total", "average"],
          changedSymbols: ["total", "average"],
          summary: "formatting_only total, average",
          removedExcerpt: "export function total(rows){",
        }),
      ],
      afterFile: () => "export function total(rows) {}\nexport function average(rows) {}",
    }),
  );
  expect(report.claims[0]!.verdict).toBe("delivered");
  expect(report.verdict).toBe("allow");
});

test("a preservation claim naming a symbol still standing cites where it still lives", () => {
  const report = decide(
    decideInput({
      claims: [
        claim("c1", "keep paginate working", { kind: "preservation", keywords: ["paginate"] }),
      ],
      hunks: [
        hunk("h1", {
          file: "pagination.ts",
          symbols: ["paginate", "encodeCursor"],
          changedSymbols: ["encodeCursor"],
          summary: "new_function encodeCursor",
        }),
      ],
      afterFile: () => "export function paginate(items) {}",
    }),
  );
  expect(report.claims[0]!.verdict).toBe("delivered");
  expect(report.claims[0]!.evidence[0]!.detail).toBe("still declared here and not changed");
});

test("a claim keyword glued into one lowercase word still matches a camelCase symbol", () => {
  expect(symbolNamedByClaim("createUser", new Set(["other"]), [["createuser"]])).toBe(true);
  expect(symbolNamedByClaim("createUser", new Set(["createuser"]), [])).toBe(true);
  expect(symbolNamedByClaim("createUser", new Set(["delete"]), [["deleteuser"]])).toBe(false);
  expect(symbolNamedByClaim("", new Set(["x"]), [["x"]])).toBe(false);
});

test("an unreadable file after the change is treated as naming nothing, not as a deletion", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "keep the retry logic", { kind: "preservation", keywords: ["retry"] })],
      hunks: [
        hunk("h1", {
          file: "gone.ts",
          symbols: [],
          changedSymbols: [],
          summary: "deletion gone.ts",
          removedExcerpt: "export function retryRequest() {}",
        }),
      ],
      afterFile: () => {
        throw new Error("ENOENT");
      },
    }),
  );
  expect(report.claims[0]!.verdict).toBe("dropped");
});

test("with no way to read the file afterwards a preservation claim cannot be proven dropped", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "keep the retry logic", { kind: "preservation", keywords: ["retry"] })],
      hunks: [
        hunk("h1", {
          file: "retry.ts",
          symbols: [],
          changedSymbols: [],
          summary: "deletion retry.ts",
          removedExcerpt: "export function retryRequest() {}",
        }),
      ],
    }),
  );
  expect(report.claims[0]!.verdict).toBe("dropped");
});

test("decide preserves symbols merely spanned by a sibling addition", () => {
  const report = decide(
    decideInput({
      claims: [
        claim("c1", "keep getUser and listUsers unchanged", {
          kind: "preservation",
          keywords: ["getuser", "listusers"],
        }),
      ],
      hunks: [
        hunk("h1", {
          symbols: ["getUser", "deleteUser", "listUsers"],
          changedSymbols: ["deleteUser"],
          summary: "new_function getUser, deleteUser, listUsers",
        }),
      ],
    }),
  );
  expect(report.claims[0]).toMatchObject({ verdict: "delivered", origin: "preservation" });
  expect(report.claims[0]!.evidence[0]!.detail).toBe("still declared here and not changed");
});

test("decide reports uncited meaningful hunks as scope creep, largest first", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "add rate limiting")],
      hunks: [
        hunk("h1", { symbols: ["applyRateLimit"], summary: "new_function applyRateLimit" }),
        hunk("h2", { file: "pagination.ts", symbols: ["paginate"], addedLines: 62 }),
        hunk("h3", { file: "extras.ts", symbols: ["extra"], addedLines: 5 }),
        hunk("h4", { file: "tiny.ts", symbols: ["tiny"], addedLines: 4 }),
        hunk("h5", { file: "style.ts", category: "formatting_only", addedLines: 30 }),
        hunk("h6", { file: "docs/guide.md", category: "test_or_doc", addedLines: 30 }),
      ],
      proposals: [{ claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "keyword" }],
    }),
  );
  expect(report.scope_creep.map((row) => row.hunk_id)).toEqual(["h2", "h3"]);
  expect(report.scope_creep[0]).toMatchObject({ file: "pagination.ts", added_lines: 62 });
  expect(report.verdict).toBe("warn");
});

test("decide blocks on hallucinations even when every claim is delivered", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "add rate limiting")],
      hunks: [hunk("h1")],
      proposals: [{ claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "keyword" }],
      hallucinations: [HALLUCINATION],
    }),
  );
  expect(report.verdict).toBe("block");
  expect(report.exit).toBe(20);
  expect(report.hallucinations).toEqual([HALLUCINATION]);
});

test("decide carries partial llm statuses with citations through", () => {
  const report = decide(
    decideInput({
      claims: [claim("c1", "handle empty responses")],
      hunks: [hunk("h1")],
      proposals: [{ claimId: "c1", hunkIds: ["h1"], status: "partial", origin: "llm" }],
    }),
  );
  expect(report.claims[0]).toMatchObject({ verdict: "partial", hunk_refs: ["api-client.ts:1-10"] });
  expect(report.verdict).toBe("warn");
});
