import { expect, test } from "bun:test";
import { intentSummaryLine, renderIntentReport } from "../../src/intent/report.ts";
import type { ClaimRow, IntentReport } from "../../src/intent/types.ts";

function row(over: Partial<ClaimRow>): ClaimRow {
  return {
    claim_id: "c1",
    claim: "Add rate limiting",
    kind: "behavior",
    verdict: "delivered",
    hunk_refs: ["api-client.ts:1-10"],
    evidence: [{ file: "api-client.ts", line: 1, detail: "new_function fetchPage" }],
    origin: "keyword",
    ...over,
  };
}

function report(over: Partial<IntentReport> = {}): IntentReport {
  return {
    schema_version: 1,
    source: "prompt",
    prompt: "add rate limiting",
    base: "abc123def4567890",
    claims: [],
    scope_creep: [],
    hallucinations: [],
    verdict: "allow",
    exit: 0,
    llm: { extract_calls: 1, match_calls: 1 },
    ...over,
  };
}

test("intentSummaryLine counts each verdict class", () => {
  const line = intentSummaryLine(
    report({
      claims: [
        row({}),
        row({ claim_id: "c2", verdict: "dropped" }),
        row({ claim_id: "c3", verdict: "partial" }),
      ],
      scope_creep: [
        {
          hunk_id: "h9",
          file: "pagination.ts",
          line_start: 1,
          line_end: 62,
          added_lines: 62,
          summary: "other paginate",
        },
      ],
      hallucinations: [
        {
          symbol: "axios.instance.throttle",
          package: "axios",
          file: "api-client.ts",
          line: 4,
          proof: "axios instance has no member 'throttle'",
          source: "curated",
        },
      ],
    }),
  );
  expect(line).toBe("1 ✅ · 1 ❌ · 2 ⚠️ · 1 🚨");
});

test("renderIntentReport shows every row class with references and proof", () => {
  const rendered = renderIntentReport(
    report({
      claims: [
        row({}),
        row({
          claim_id: "c2",
          claim: "log every request",
          verdict: "dropped",
          hunk_refs: [],
          evidence: [{ file: "-", detail: "no matching change found" }],
        }),
        row({
          claim_id: "c3",
          claim: "keep the retry logic",
          kind: "preservation",
          verdict: "dropped",
          hunk_refs: ["retry.ts:1-5"],
          evidence: [{ file: "retry.ts", line: 1, detail: "asked to preserve, but changed" }],
          origin: "preservation",
        }),
        row({
          claim_id: "c4",
          claim: "handle empty responses",
          verdict: "partial",
          hunk_refs: [],
          evidence: [{ file: "-", detail: "not verifiable: match llm unavailable" }],
        }),
      ],
      scope_creep: [
        {
          hunk_id: "h9",
          file: "pagination.ts",
          line_start: 1,
          line_end: 62,
          added_lines: 62,
          summary: "other paginate",
        },
      ],
      hallucinations: [
        {
          symbol: "axios.instance.throttle",
          package: "axios",
          file: "api-client.ts",
          line: 4,
          proof: "axios instance has no member 'throttle'. Known: get, post (curated signature db)",
          source: "curated",
        },
      ],
      verdict: "block",
      exit: 20,
    }),
  );
  expect(rendered).toContain("VERDICT:");
  expect(rendered).toContain("✅ Add rate limiting");
  expect(rendered).toContain("[api-client.ts:1-10]");
  expect(rendered).toContain("❌ DROPPED: log every request");
  expect(rendered).toContain("[no matching change found]");
  expect(rendered).toContain("❌ NOT PRESERVED: keep the retry logic");
  expect(rendered).toContain("⚠️ handle empty responses");
  expect(rendered).toContain("⚠️ SCOPE CREEP: pagination.ts — 62 lines changed, never requested");
  expect(rendered).toContain("🚨 HALLUCINATED: axios.instance.throttle");
  expect(rendered).toContain("axios instance has no member 'throttle'");
  expect(rendered).toContain("merge-base abc123def456");
  expect(rendered).toContain("llm calls: 2");
});

test("renderIntentReport handles an empty report", () => {
  const rendered = renderIntentReport(report());
  expect(rendered).toContain("0 ✅ · 0 ❌ · 0 ⚠️ · 0 🚨");
});
