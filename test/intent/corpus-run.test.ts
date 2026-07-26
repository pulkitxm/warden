import { expect, test } from "bun:test";
import { CORPUS_CASES, type CorpusCase } from "../../src/intent/corpus/cases.ts";
import { renderCorpus } from "../../src/intent/corpus/report.ts";
import {
  CORPUS_ROOT,
  corpusDeps,
  corpusFiles,
  FALSE_POSITIVE_BUDGET,
  KNOWN_GAPS,
  liveCorpusLlm,
  replayLlm,
  runCorpus,
  runCorpusCase,
} from "../../src/intent/corpus/run.ts";
import { liveIntentLlm } from "../../src/intent/pipeline.ts";
import type { ClassifiedHunk, IntentClaim } from "../../src/intent/types.ts";

const HUNK: ClassifiedHunk = {
  id: "h1",
  file: "a.js",
  lineStart: 1,
  lineEnd: 2,
  category: "new_function",
  summary: "new_function alpha",
  symbols: ["alpha"],
  changedSymbols: ["alpha"],
  imports: [],
  addedLines: 2,
  excerpt: "const alpha = 1;",
  removedExcerpt: "",
};

const CLAIM: IntentClaim = {
  id: "c1",
  claim: "Add alpha",
  kind: "behavior",
  keywords: ["alpha"],
  sourceText: "add alpha",
};

function caseWith(overrides: Partial<CorpusCase>): CorpusCase {
  return {
    id: "synthetic",
    shape: "a synthetic case used to exercise the harness itself",
    kind: "conforming",
    prompt: "add alpha",
    changes: [{ path: "a.js", after: "export const alpha = 1;\n" }],
    extract: [CLAIM],
    match: [{ claim_id: "c1", hunk_ids: ["h1"], status: "delivered" }],
    expected: { verdict: "allow", claims: ["delivered"], scopeCreep: false, hallucinations: 0 },
    ...overrides,
  };
}

test("corpus files carry the post-change image, the manifest, and any node_modules", () => {
  const files = corpusFiles(
    caseWith({
      changes: [
        { path: "a.js", after: "const a = 1;\n" },
        { path: "gone.js", before: "const b = 2;\n" },
      ],
      manifest: { dependencies: { axios: "^1.0.0" } },
      nodeModules: { "pkg/index.js": "module.exports = {};" },
    }),
  );
  expect(files.get("a.js")).toContain("const a = 1;");
  expect(files.has("gone.js")).toBe(false);
  expect(files.get("package.json")).toContain("axios");
  expect(files.get("node_modules/pkg/index.js")).toBe("module.exports = {};");
});

test("the corpus deps answer git diff with the fixture and everything else with nothing", () => {
  const deps = corpusDeps(caseWith({}));
  expect(deps.git(["diff", "base"], CORPUS_ROOT).stdout).toContain("diff --git");
  expect(deps.git(["ls-files"], CORPUS_ROOT).stdout).toBe("");
});

test("the corpus deps read a fixture path and throw for anything absent", () => {
  const deps = corpusDeps(caseWith({}));
  expect(deps.readFile(`${CORPUS_ROOT}/a.js`)).toContain("alpha");
  expect(() => deps.readFile(`${CORPUS_ROOT}/missing.js`)).toThrow("ENOENT");
});

test("a case marked unavailable makes extraction reject the way a missing key does", async () => {
  const llm = replayLlm(caseWith({ extract: "unavailable" }));
  await expect(llm.extract("add alpha")).rejects.toThrow("no llm api key configured");
});

test("a recorded extraction replays with the ids the live extractor would assign", async () => {
  const llm = replayLlm(caseWith({ extract: [CLAIM, { ...CLAIM, claim: "Add beta" }] }));
  const ledger = await llm.extract("add alpha and beta");
  expect(ledger.claims.map((claim) => claim.id)).toEqual(["c1", "c2"]);
  expect(ledger.source_text).toBe("add alpha and beta");
});

test("a replayed match with nothing to judge makes no call and does not fail", async () => {
  const llm = replayLlm(caseWith({}));
  expect(await llm.match([], [HUNK])).toEqual({ proposals: [], failed: false });
  expect(await llm.match([CLAIM], [])).toEqual({ proposals: [], failed: false });
});

test("a case with no recorded match, or an unavailable one, replays as a failed call", async () => {
  const absent = replayLlm(caseWith({ match: undefined }));
  expect(await absent.match([CLAIM], [HUNK])).toEqual({ proposals: [], failed: true });
  const unavailable = replayLlm(caseWith({ match: "unavailable" }));
  expect(await unavailable.match([CLAIM], [HUNK])).toEqual({ proposals: [], failed: true });
});

test("a recorded match replays through the real proposal parser", async () => {
  const llm = replayLlm(caseWith({}));
  const result = await llm.match([CLAIM], [HUNK]);
  expect(result.failed).toBe(false);
  expect(result.proposals).toEqual([
    { claimId: "c1", hunkIds: ["h1"], status: "delivered", origin: "llm" },
  ]);
});

test("a recorded match citing an unknown hunk has that citation dropped, not trusted", async () => {
  const llm = replayLlm(
    caseWith({ match: [{ claim_id: "c1", hunk_ids: ["h99"], status: "delivered" }] }),
  );
  const result = await llm.match([CLAIM], [HUNK]);
  expect(result.proposals[0]?.hunkIds).toEqual([]);
});

test("a case that meets reviewer truth is scored correct", async () => {
  const result = await runCorpusCase(caseWith({}));
  expect(result.correct).toBe(true);
  expect(result.actualVerdict).toBe("allow");
  expect(result.actualClaims).toEqual(["delivered"]);
});

test("a missing provider yields a warn with no claims rather than erasing the run", async () => {
  const result = await runCorpusCase(caseWith({ extract: "unavailable" }));
  expect(result.actualVerdict).toBe("warn");
  expect(result.actualClaims).toEqual([]);
});

test("a pipeline that throws is recorded as an error verdict rather than crashing the run", async () => {
  const result = await runCorpusCase(caseWith({}), {
    extract: (prompt) =>
      Promise.resolve({
        schema_version: 1,
        source: "prompt",
        source_text: prompt,
        claims: [CLAIM],
      }),
    match: () => Promise.reject(new Error("the matcher exploded")),
  });
  expect(result.actualVerdict).toBe("error");
  expect(result.actualClaims).toEqual([]);
  expect(result.correct).toBe(false);
});

test("a mismatch on any axis marks the case incorrect", async () => {
  const wrongVerdict = await runCorpusCase(
    caseWith({
      expected: { verdict: "block", claims: ["delivered"], scopeCreep: false, hallucinations: 0 },
    }),
  );
  expect(wrongVerdict.correct).toBe(false);
  const wrongClaims = await runCorpusCase(
    caseWith({
      expected: { verdict: "allow", claims: ["dropped"], scopeCreep: false, hallucinations: 0 },
    }),
  );
  expect(wrongClaims.correct).toBe(false);
  const wrongCreep = await runCorpusCase(
    caseWith({
      expected: { verdict: "allow", claims: ["delivered"], scopeCreep: true, hallucinations: 0 },
    }),
  );
  expect(wrongCreep.correct).toBe(false);
  const wrongHallucinations = await runCorpusCase(
    caseWith({
      expected: { verdict: "allow", claims: ["delivered"], scopeCreep: false, hallucinations: 1 },
    }),
  );
  expect(wrongHallucinations.correct).toBe(false);
});

test("an explicit llm overrides the replay, which is how the live drift check runs", async () => {
  const result = await runCorpusCase(caseWith({}), {
    extract: () =>
      Promise.resolve({
        schema_version: 1,
        source: "prompt",
        source_text: "add alpha",
        claims: [CLAIM],
      }),
    match: (_claims, hunks) =>
      Promise.resolve({
        proposals: [
          {
            claimId: "c1",
            hunkIds: hunks.map((hunk) => hunk.id),
            status: "delivered",
            origin: "llm",
          },
        ],
        failed: false,
      }),
  });
  expect(result.actualClaims).toEqual(["delivered"]);
});

test("an empty corpus reports full rates instead of dividing by zero", async () => {
  const report = await runCorpus([], "test");
  expect(report.totals.cases).toBe(0);
  expect(report.verdicts.rate).toBe(1);
  expect(report.falsePositives.rate).toBe(0);
  expect(report.falsePositives.withinBudget).toBe(true);
  for (const score of Object.values(report.rules)) {
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
  }
});

test("a conforming case that stops counts against the false-positive budget", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "stops-a-clean-diff",
        changes: [{ path: "a.js", after: "export const alpha = 1;\n" }],
        match: [{ claim_id: "c1", hunk_ids: [], status: "dropped" }],
        expected: { verdict: "allow", claims: ["delivered"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  expect(report.falsePositives.count).toBe(1);
  expect(report.falsePositives.rate).toBe(1);
  expect(report.falsePositives.withinBudget).toBe(false);
  expect(report.rules.claim_matching?.falsePositives).toBe(1);
});

test("a violating case whose dropped claim is found scores as a true positive", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "finds-the-dropped-claim",
        kind: "violating",
        match: [{ claim_id: "c1", hunk_ids: [], status: "dropped" }],
        expected: { verdict: "block", claims: ["dropped"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  expect(report.rules.claim_matching?.truePositives).toBe(1);
  expect(report.rules.claim_matching?.precision).toBe(1);
  expect(report.rules.claim_matching?.recall).toBe(1);
  expect(report.falsePositives.count).toBe(0);
});

test("a dropped claim the rules miss is counted as a false negative", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "misses-the-dropped-claim",
        kind: "violating",
        expected: { verdict: "block", claims: ["dropped"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  expect(report.rules.claim_matching?.falseNegatives).toBe(1);
  expect(report.rules.claim_matching?.recall).toBe(0);
});

test("a known gap that starts passing is reported as stale rather than left to rot", async () => {
  const id = Object.keys(KNOWN_GAPS)[0] as string;
  const report = await runCorpus([caseWith({ id })], "test");
  expect(report.staleGaps).toEqual([id]);
  expect(report.knownGaps).toEqual([]);
});

test("a known gap that still fails is listed as a known gap and still counted as a failure", async () => {
  const id = Object.keys(KNOWN_GAPS)[0] as string;
  const report = await runCorpus(
    [
      caseWith({
        id,
        expected: { verdict: "block", claims: ["delivered"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  expect(report.knownGaps).toEqual([id]);
  expect(report.verdicts.correct).toBe(0);
});

test("the live corpus llm is the same provider the cli uses", () => {
  expect(liveCorpusLlm()).toBe(liveIntentLlm);
});

test("the budget is a stated number the report carries with it", async () => {
  const report = await runCorpus([], "test");
  expect(report.falsePositives.budget).toBe(FALSE_POSITIVE_BUDGET);
  expect(FALSE_POSITIVE_BUDGET).toBe(0.05);
});

test("the method is published alongside the numbers", async () => {
  const report = await runCorpus([], "test");
  expect(report.method.length).toBeGreaterThanOrEqual(5);
  expect(report.method.join(" ")).toContain("curated shapes, not a sample of real pull requests");
  expect(report.method.join(" ")).toContain("same pipeline the cli uses");
});

test("the rendered report names every failing case and whether it is a known gap", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "a-regression",
        kind: "violating",
        expected: { verdict: "block", claims: ["delivered"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  const text = renderCorpus(report);
  expect(text).toContain("a-regression");
  expect(text).toContain("expected block, got allow");
  expect(text).toContain("regression");
  expect(text).toContain("claim_matching");
});

test("the rendered report says when the false-positive rate is over the stated budget", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "stops-a-clean-diff",
        match: [{ claim_id: "c1", hunk_ids: [], status: "dropped" }],
      }),
    ],
    "test",
  );
  expect(renderCorpus(report)).toContain("over budget");
});

test("a degraded case is scored but kept out of the false-positive denominator", async () => {
  const report = await runCorpus(
    [
      caseWith({
        id: "provider-down",
        kind: "degraded",
        match: "unavailable",
        expected: { verdict: "warn", claims: ["partial"], scopeCreep: false, hallucinations: 0 },
      }),
    ],
    "test",
  );
  expect(report.totals.degraded).toBe(1);
  expect(report.totals.conforming).toBe(0);
  expect(report.falsePositives.count).toBe(0);
  expect(report.verdicts.correct).toBe(1);
});

test("the rendered report says so plainly when every case matches", async () => {
  const text = renderCorpus(await runCorpus([caseWith({})], "test"));
  expect(text).toContain("every case matches reviewer truth");
  expect(text).toContain("within budget");
});

test("the rendered report calls out a stale known gap", async () => {
  const id = Object.keys(KNOWN_GAPS)[0] as string;
  const text = renderCorpus(await runCorpus([caseWith({ id })], "test"));
  expect(text).toContain("Known gaps that now pass");
  expect(text).toContain(id);
});

test("every corpus case has a unique id and documents the shape it stands for", () => {
  const ids = CORPUS_CASES.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of CORPUS_CASES) expect(entry.shape.length).toBeGreaterThan(20);
});

test("every known gap names a case that exists, so the list cannot drift", () => {
  const ids = new Set(CORPUS_CASES.map((entry) => entry.id));
  for (const id of Object.keys(KNOWN_GAPS)) expect(`${id}: ${ids.has(id)}`).toBe(`${id}: true`);
});

test("a conforming case always expects a plain allow", () => {
  for (const entry of CORPUS_CASES.filter((row) => row.kind === "conforming")) {
    expect(`${entry.id}: ${entry.expected.verdict}`).toBe(`${entry.id}: allow`);
  }
});

test("a violating case never expects a plain allow", () => {
  for (const entry of CORPUS_CASES.filter((row) => row.kind === "violating")) {
    expect(`${entry.id}: ${entry.expected.verdict}`).not.toBe(`${entry.id}: allow`);
  }
});

test("the corpus holds enough of both kinds for the rates to mean something", () => {
  const conforming = CORPUS_CASES.filter((entry) => entry.kind === "conforming");
  const violating = CORPUS_CASES.filter((entry) => entry.kind === "violating");
  expect(conforming.length).toBeGreaterThanOrEqual(10);
  expect(violating.length).toBeGreaterThanOrEqual(6);
});

test("a degraded case is neither conforming nor violating, so the kinds stay disjoint", () => {
  const kinds = new Set(CORPUS_CASES.map((entry) => entry.kind));
  for (const kind of kinds) expect(["conforming", "violating", "degraded"]).toContain(kind);
});

test("every case either pins an outcome per recorded claim or declines to pin any", () => {
  for (const entry of CORPUS_CASES) {
    if (entry.extract === "unavailable" || entry.expected.claims === "unpinned") continue;
    expect(`${entry.id}: ${entry.expected.claims.length}`).toBe(
      `${entry.id}: ${entry.extract.length}`,
    );
  }
});

test("a case only declines to pin claim truth when it pins another axis instead", () => {
  for (const entry of CORPUS_CASES.filter((row) => row.expected.claims === "unpinned")) {
    expect(`${entry.id}: ${entry.expected.hallucinations > 0 || entry.expected.scopeCreep}`).toBe(
      `${entry.id}: true`,
    );
  }
});
