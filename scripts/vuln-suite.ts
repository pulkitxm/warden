#!/usr/bin/env bun
/**
 * Vulnerability test suite + confusion matrix.
 *
 * Runs a labeled dataset of npm supply-chain cases through the WNPM engine and
 * scores it as a binary classifier (positive = "should block" = malicious).
 * Malicious cases are faithful fixtures (never real live malware); benign cases
 * are REAL popular packages fetched live via the proxying mini-registry.
 *
 * No LLM: OPENAI_API_KEY is cleared, so the engine runs pure heuristics — zero
 * model tokens. One process, bounded concurrency.
 *
 * Run: bun scripts/vuln-suite.ts
 * Prints a Markdown report to stdout.
 */

import { startMiniRegistry } from "../fixtures/registry/server.ts";
import { ATTACK_FIXTURES } from "../fixtures/registry/attack-fixtures.ts";
import { VerdictCache } from "../src/cache.ts";

type Label = "malicious" | "benign";
interface Case {
  spec: string;
  label: Label;
  type: string;
}

// --- Malicious: crafted attack fixtures (one per technique) ------------------
const MAL_FIXTURES: Case[] = [
  { spec: "mal-postinstall-env@1.0.1", label: "malicious", type: "postinstall-env-exfil" },
  { spec: "mal-preinstall-harvester@2.0.0", label: "malicious", type: "preinstall-cred-harvester" },
  { spec: "mal-curl-bash@0.0.1", label: "malicious", type: "curl-pipe-bash" },
  { spec: "mal-obfuscated-eval@1.2.0", label: "malicious", type: "obfuscated-eval-drainer" },
  { spec: "mal-provenance-downgrade@1.0.1", label: "malicious", type: "provenance-downgrade" },
  { spec: "mal-base64-loader@1.0.0", label: "malicious", type: "base64-eval-loader" },
  { spec: "mal-source-leak@1.0.0", label: "malicious", type: "source-code-leak" },
  { spec: "mal-secret-theft@1.0.0", label: "malicious", type: "secret-file-theft" },
  { spec: "mal-imds-steal@1.0.0", label: "malicious", type: "cloud-imds-theft" },
  { spec: "mal-reverse-shell@1.0.0", label: "malicious", type: "reverse-shell" },
  { spec: "@acme-corp/internal-config@99.0.0", label: "malicious", type: "dependency-confusion" },
  { spec: "mal-protestware@2.0.0", label: "malicious", type: "protestware" },
  { spec: "mal-fake-native@1.0.0", label: "malicious", type: "fake-native-download" },
];

// --- Malicious: real name attacks (proxied to real npm) ----------------------
const MAL_NAMES: Case[] = [
  { spec: "lodahs", label: "malicious", type: "typosquat" },
  { spec: "expresss", label: "malicious", type: "typosquat" },
  { spec: "reqeust", label: "malicious", type: "typosquat" },
  { spec: "momnet", label: "malicious", type: "typosquat" },
  { spec: "axsios", label: "malicious", type: "typosquat" },
  { spec: "l0dash", label: "malicious", type: "homoglyph-typosquat" },
  { spec: "react-hooks-fetcher-helper-xyz", label: "malicious", type: "slopsquat" },
  { spec: "data-fetch-utils-pro-2026", label: "malicious", type: "slopsquat" },
  { spec: "@typescript_eslinter/eslint", label: "malicious", type: "slopsquat-scoped" },
  { spec: "chalk@5.6.1", label: "malicious", type: "blocklist-known-malware" },
  { spec: "axios@1.14.1", label: "malicious", type: "blocklist-known-malware" },
  { spec: "plain-crypto-js", label: "malicious", type: "blocklist-known-malware" },
];

// --- Benign: real popular packages (proxied to real npm) ---------------------
const BENIGN: Case[] = [
  "react", "react-dom", "vue", "svelte", "lodash", "express", "koa", "fastify",
  "axios", "got", "node-fetch", "undici", "chalk", "commander", "yargs",
  "typescript", "esbuild", "webpack", "rollup", "vite", "@babel/core",
  "@types/node", "@typescript-eslint/parser", "eslint", "prettier", "jest",
  "vitest", "sharp", "node-gyp", "bcrypt", "better-sqlite3", "dotenv",
  "cross-env", "uuid", "semver", "glob", "rimraf", "ms", "qs", "ws", "debug",
  "three", "d3", "moment", "zod", "next", "core-js", "chokidar",
].map((spec) => ({ spec, label: "benign" as Label, type: "real-popular" }));

const CASES: Case[] = [...MAL_FIXTURES, ...MAL_NAMES, ...BENIGN];

interface Result extends Case {
  verdict: "block" | "warn" | "allow" | "error";
  score: number;
  categories: string[];
  source: string;
  error?: string;
}

async function runPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  delete process.env.OPENAI_API_KEY; // no LLM — zero model tokens
  const reg = startMiniRegistry(0, { proxy: true, only: true, fixtures: ATTACK_FIXTURES });
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  const { checkPackage } = await import("../src/engine.ts");
  const cache = new VerdictCache(":memory:");

  process.stderr.write(`Running ${CASES.length} cases (no LLM) against ${reg.url} ...\n`);

  const results = await runPool<Case, Result>(CASES, 3, async (c) => {
    try {
      const v = await checkPackage(c.spec, { cache });
      return { ...c, verdict: v.verdict, score: v.risk_score, categories: v.categories, source: v.source };
    } catch (e) {
      return { ...c, verdict: "error", score: 0, categories: [], source: "-", error: (e as Error).message };
    }
  });
  reg.stop();

  // --- Confusion matrix (strict: positive prediction = block) ----------------
  let tp = 0, fp = 0, tn = 0, fn = 0;
  let lenientTp = 0, lenientFn = 0; // lenient: block OR warn counts as flagged
  const failures: Result[] = [];
  const errors: Result[] = [];

  for (const r of results) {
    if (r.verdict === "error") {
      errors.push(r);
      if (r.label === "malicious") { fn++; lenientFn++; failures.push(r); }
      continue;
    }
    const blocked = r.verdict === "block";
    const flagged = r.verdict === "block" || r.verdict === "warn";
    if (r.label === "malicious") {
      if (blocked) tp++; else { fn++; failures.push(r); }
      if (flagged) lenientTp++; else lenientFn++;
    } else {
      if (blocked) { fp++; failures.push(r); } else tn++;
    }
  }

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // --- Per-type breakdown ----------------------------------------------------
  const byType = new Map<string, { label: Label; block: number; warn: number; allow: number; error: number; total: number }>();
  for (const r of results) {
    const k = `${r.label}:${r.type}`;
    const e = byType.get(k) ?? { label: r.label, block: 0, warn: 0, allow: 0, error: 0, total: 0 };
    e[r.verdict] = (e[r.verdict] as number) + 1;
    e.total++;
    byType.set(k, e);
  }

  // --- Write report ----------------------------------------------------------
  const L: string[] = [];
  L.push("# WNPM — Vulnerability Suite Results\n");
  L.push(`Cases: ${CASES.length} (malicious ${MAL_FIXTURES.length + MAL_NAMES.length}, benign ${BENIGN.length}). No LLM (pure heuristics).\n`);
  L.push("## Confusion matrix (positive = should block)\n");
  L.push("```");
  L.push("                 predicted BLOCK   predicted not-block");
  L.push(`malicious (P)         TP=${tp}              FN=${fn}`);
  L.push(`benign    (N)         FP=${fp}              TN=${tn}`);
  L.push("```");
  L.push(`- Recall (malicious caught, strict block): ${pct(tp, tp + fn)}`);
  L.push(`- Precision (of blocks, how many truly malicious): ${pct(tp, tp + fp)}`);
  L.push(`- Specificity (benign correctly not blocked): ${pct(tn, tn + fp)}`);
  L.push(`- Accuracy: ${pct(tp + tn, tp + tn + fp + fn)}  ·  F1: ${f1.toFixed(2)}`);
  L.push(`- Lenient recall (malicious at least WARNed): ${pct(lenientTp, lenientTp + lenientFn)}`);
  if (errors.length) L.push(`- Errors (analysis failures): ${errors.length}`);
  L.push("");
  L.push("## Failure points (analyze these)\n");
  L.push("### False negatives — malicious NOT blocked (misses)");
  const fns = failures.filter((r) => r.label === "malicious");
  if (!fns.length) L.push("_(none)_");
  for (const r of fns) L.push(`- **${r.type}** \`${r.spec}\` -> ${r.verdict.toUpperCase()} (score ${r.score}) [${r.categories.join(",")}]${r.error ? ` err=${r.error}` : ""}`);
  L.push("");
  L.push("### False positives — benign blocked (false alarms)");
  const fps = failures.filter((r) => r.label === "benign");
  if (!fps.length) L.push("_(none)_");
  for (const r of fps) L.push(`- \`${r.spec}\` -> BLOCK (score ${r.score}) [${r.categories.join(",")}]`);
  L.push("");
  if (errors.length) {
    L.push("### Errors");
    for (const r of errors) L.push(`- \`${r.spec}\` (${r.label}) -> ${r.error}`);
    L.push("");
  }
  L.push("## Per-type breakdown\n");
  L.push("| label:type | total | block | warn | allow | error |");
  L.push("|---|---|---|---|---|---|");
  for (const [k, e] of [...byType.entries()].sort()) {
    L.push(`| ${k} | ${e.total} | ${e.block} | ${e.warn} | ${e.allow} | ${e.error} |`);
  }
  L.push("");
  L.push("## All results\n");
  L.push("| spec | label | type | verdict | score | categories |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results.slice().sort((a, b) => a.label.localeCompare(b.label) || a.spec.localeCompare(b.spec))) {
    L.push(`| ${r.spec} | ${r.label} | ${r.type} | ${r.verdict} | ${r.score} | ${r.categories.join(",")} |`);
  }
  const md = L.join("\n") + "\n";

  process.stdout.write(md);

  // Console summary
  process.stderr.write(
    `\nDONE. TP=${tp} FP=${fp} TN=${tn} FN=${fn} | recall(strict)=${pct(tp, tp + fn)} recall(lenient)=${pct(lenientTp, lenientTp + lenientFn)} precision=${pct(tp, tp + fp)} specificity=${pct(tn, tn + fp)}\n` +
      `Misses(FN)=${fns.length} FalseAlarms(FP)=${fps.length} Errors=${errors.length}\n`,
  );
}

main();
