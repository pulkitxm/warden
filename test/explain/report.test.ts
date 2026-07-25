import { expect, test } from "bun:test";
import {
  buildExplain,
  buildHistory,
  compareRow,
  confidenceOf,
  rankComparison,
} from "../../src/explain/report.ts";
import type { PackageMeta } from "../../src/registry.ts";
import type { Category, Verdict } from "../../src/schema.ts";

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    schema_version: 1,
    package: "left-pad",
    version: "1.3.0",
    integrity: "sha512-lp",
    verdict: "allow",
    risk_score: 0,
    categories: [],
    summary: "no findings",
    evidence: [],
    analyzer_version: "test",
    source: "heuristics",
    ...over,
  };
}

function meta(over: Partial<PackageMeta> = {}): PackageMeta {
  return {
    name: "left-pad",
    version: "1.3.0",
    existsOnRegistry: true,
    versions: ["1.0.0", "1.2.0", "1.3.0"],
    maintainers: ["dev"],
    ...over,
  };
}

test("a blocklist hit is high confidence, not a guess", () => {
  expect(confidenceOf(verdict({ source: "blocklist", verdict: "block" }))).toBe("high");
});

test("known malware is high confidence whatever the source", () => {
  expect(
    confidenceOf(verdict({ verdict: "block", categories: ["known_malware"] as Category[] })),
  ).toBe("high");
});

test("a block with several pieces of evidence is more confident than one with none", () => {
  const many = verdict({
    verdict: "block",
    evidence: [
      { file: "a.js", detail: "one" },
      { file: "b.js", detail: "two" },
    ],
  });
  expect(confidenceOf(many)).toBe("high");
  expect(confidenceOf(verdict({ verdict: "block" }))).toBe("low");
  expect(confidenceOf(verdict({ verdict: "warn", evidence: [{ file: "a", detail: "x" }] }))).toBe(
    "medium",
  );
});

test("a cached allow is medium confidence, because it was not re-analyzed", () => {
  expect(confidenceOf(verdict({ source: "cache" }))).toBe("medium");
  expect(confidenceOf(verdict({ source: "heuristics" }))).toBe("high");
});

test("the explanation leads with decision, confidence, and reason codes", () => {
  const report = buildExplain(
    verdict({ verdict: "block", categories: ["known_malware", "exfiltration"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.decision).toBe("block");
  expect(report.confidence).toBe("high");
  expect(report.reason_codes).toEqual(["known_malware", "exfiltration"]);
});

test("duplicate categories collapse into one reason code", () => {
  const report = buildExplain(
    verdict({ categories: ["typosquat", "typosquat"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.reason_codes).toEqual(["typosquat"]);
});

test("every reason code is translated into what it means for the user", () => {
  const report = buildExplain(
    verdict({ verdict: "block", categories: ["slopsquat"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.why_it_matters[0]).toContain("language models are known to invent");
});

test("a block states what was prevented, which is the point of blocking", () => {
  const report = buildExplain(
    verdict({ verdict: "block", categories: ["install_script"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.prevented).toEqual(["the install script did not execute"]);
});

test("a block with no mapped category still says nothing executed", () => {
  const report = buildExplain(
    verdict({ verdict: "block", categories: ["metadata_anomaly"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.prevented).toEqual(["nothing from this package was executed"]);
});

test("an allow prevents nothing and says so by staying empty", () => {
  expect(buildExplain(verdict(), meta(), "0.1.0").prevented).toEqual([]);
});

test("the previous release is named as the baseline the delta was measured against", () => {
  const report = buildExplain(verdict(), meta({ previousVersion: "1.2.0" }), "0.1.0");
  expect(report.baseline).toEqual({
    version: "1.2.0",
    source: "the previous published release",
  });
  expect(report.what_changed[0]).toBe("1.2.0 to 1.3.0");
});

test("a first release says so rather than inventing a baseline", () => {
  const report = buildExplain(verdict(), meta(), "0.1.0");
  expect(report.baseline).toBeNull();
  expect(report.what_changed[0]).toContain("first release");
});

test("newly added scripts, a changed publisher, and lost provenance are all called out", () => {
  const report = buildExplain(
    verdict(),
    meta({
      previousVersion: "1.2.0",
      previousScripts: { test: "jest" },
      scripts: { test: "jest", postinstall: "node x.js" },
      maintainerEmailChanged: true,
      previousHadProvenance: true,
      hasProvenance: false,
      ageDays: 0.2,
      deprecated: true,
    }),
    "0.1.0",
  );
  const text = report.what_changed.join(" | ");
  expect(text).toContain("new scripts: postinstall");
  expect(text).toContain("email address changed");
  expect(text).toContain("provenance attestation");
  expect(text).toContain("less than a day ago");
  expect(text).toContain("deprecated");
});

test("with no registry metadata the explanation still renders without changes", () => {
  expect(buildExplain(verdict(), null, "0.1.0").what_changed).toEqual([]);
});

test("a name that does not exist on the registry is never described as a first release", () => {
  const report = buildExplain(verdict(), meta({ existsOnRegistry: false, versions: [] }), "0.1.0");
  expect(report.what_changed).toEqual(["this name is not published on the registry"]);
});

test("a blocked package is pointed at comparison and history, not at an install", () => {
  const report = buildExplain(verdict({ verdict: "block" }), meta(), "0.1.0");
  expect(report.next_actions[0]).toStartWith("warden compare");
  expect(report.next_actions[1]).toStartWith("warden history");
});

test("an install script points at the narrow approval rather than a blanket override", () => {
  const report = buildExplain(
    verdict({ verdict: "warn", categories: ["install_script"] as Category[] }),
    meta(),
    "0.1.0",
  );
  expect(report.next_actions[0]).toContain("warden approve-script left-pad@1.3.0");
});

test("a clean package points at planning the install", () => {
  expect(buildExplain(verdict(), meta(), "0.1.0").next_actions[0]).toContain("warden plan");
});

test("the score is carried but labelled as heuristic rather than presented as a verdict", () => {
  const report = buildExplain(verdict({ risk_score: 62 }), meta(), "0.1.0");
  expect(report.heuristic_score).toBe(62);
  expect(Object.keys(report)).not.toContain("risk_score");
});

test("history lists the most recent releases first", () => {
  const entries = buildHistory(meta(), 10);
  expect(entries.map((entry) => entry.version)).toEqual(["1.3.0", "1.2.0", "1.0.0"]);
});

test("history honours the tail limit", () => {
  expect(buildHistory(meta(), 2).map((entry) => entry.version)).toEqual(["1.3.0", "1.2.0"]);
});

test("history annotates the current release with what changed in it", () => {
  const entries = buildHistory(
    meta({
      maintainerEmailChanged: true,
      previousHadProvenance: true,
      hasProvenance: false,
      previousScripts: {},
      scripts: { postinstall: "node x.js" },
      deprecated: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
    }),
    10,
  );
  expect(entries[0]?.changes).toEqual([
    "publisher email changed",
    "provenance lost",
    "scripts added: postinstall",
    "deprecated",
  ]);
  expect(entries[0]?.publishedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(entries[1]?.changes).toEqual([]);
});

test("a comparison row carries the facts a person would actually weigh", () => {
  const row = compareRow(
    verdict({ package: "chalk", version: "5.3.0" }),
    meta({
      weeklyDownloads: 100_000,
      ageDays: 42.6,
      hasProvenance: true,
      scripts: { postinstall: "x", test: "jest" },
    }),
    "chalk",
  );
  expect(row).toMatchObject({
    package: "chalk",
    version: "5.3.0",
    decision: "allow",
    weeklyDownloads: 100_000,
    ageDays: 43,
    hasProvenance: true,
    installScripts: ["postinstall"],
  });
});

test("a candidate that could not be analyzed is marked unknown rather than allowed", () => {
  const row = compareRow(null, null, "mystery");
  expect(row.decision).toBe("unknown");
  expect(row.version).toBe("unknown");
  expect(row.summary).toBe("not analyzed");
});

test("ranking puts a blocked candidate last, whatever its popularity", () => {
  const rows = [
    compareRow(
      verdict({ verdict: "block" }),
      meta({ weeklyDownloads: 10_000_000 }),
      "popular-evil",
    ),
    compareRow(verdict(), meta({ weeklyDownloads: 100 }), "small-clean"),
  ];
  expect(rankComparison(rows).map((row) => row.package)).toEqual(["small-clean", "popular-evil"]);
});

test("ranking prefers the more established of two clean candidates", () => {
  const rows = [
    compareRow(verdict(), meta({ weeklyDownloads: 500 }), "niche"),
    compareRow(verdict(), meta({ weeklyDownloads: 5_000_000 }), "established"),
  ];
  expect(rankComparison(rows)[0]?.package).toBe("established");
});

test("ranking penalises deprecation and install scripts", () => {
  const rows = [
    compareRow(verdict(), meta({ weeklyDownloads: 1000, deprecated: true }), "old"),
    compareRow(verdict(), meta({ weeklyDownloads: 1000 }), "current"),
  ];
  expect(rankComparison(rows)[0]?.package).toBe("current");

  const scripted = [
    compareRow(verdict(), meta({ weeklyDownloads: 1000, scripts: { postinstall: "x" } }), "builds"),
    compareRow(verdict(), meta({ weeklyDownloads: 1000 }), "pure"),
  ];
  expect(rankComparison(scripted)[0]?.package).toBe("pure");
});

test("an unknown candidate ranks below a warned one, because unknown is not safe", () => {
  const rows = [
    compareRow(null, null, "unknown"),
    compareRow(verdict({ verdict: "warn" }), meta(), "warned"),
  ];
  expect(rankComparison(rows)[0]?.package).toBe("warned");
});

test("ranking does not mutate the list it was given", () => {
  const rows = [
    compareRow(verdict({ verdict: "block" }), meta(), "a"),
    compareRow(verdict(), meta(), "b"),
  ];
  rankComparison(rows);
  expect(rows.map((row) => row.package)).toEqual(["a", "b"]);
});
