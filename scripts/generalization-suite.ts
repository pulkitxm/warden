#!/usr/bin/env bun

import { FRESH_ATTACKS } from "../fixtures/registry/fresh-attacks.ts";
import { startMiniRegistry } from "../fixtures/registry/server.ts";
import { VerdictCache } from "../src/cache.ts";

type Label = "malicious" | "benign";
interface Case {
  spec: string;
  label: Label;
  type: string;
  expect?: "catch" | "miss?";
}

const MAL: Case[] = [
  {
    spec: "fresh-hostname-exfil@1.0.0",
    label: "malicious",
    type: "hostname-env-exfil",
    expect: "miss?",
  },
  { spec: "fresh-dns-exfil@1.0.0", label: "malicious", type: "dns-exfil", expect: "miss?" },
  {
    spec: "fresh-runtime-exfil-hostname@1.0.0",
    label: "malicious",
    type: "runtime-hostname-exfil",
    expect: "miss?",
  },
  { spec: "fresh-indirect-eval@1.0.0", label: "malicious", type: "indirect-eval", expect: "miss?" },
  {
    spec: "fresh-reverse-shell-hostname@1.0.0",
    label: "malicious",
    type: "reverse-shell-hostname",
    expect: "miss?",
  },
  {
    spec: "fresh-proto-pollution@1.0.0",
    label: "malicious",
    type: "prototype-pollution",
    expect: "miss?",
  },
  {
    spec: "fresh-direct-url-dep@1.0.0",
    label: "malicious",
    type: "direct-url-dependency",
    expect: "miss?",
  },
  {
    spec: "fresh-packed-fetch-hostname@1.0.0",
    label: "malicious",
    type: "packed-fetch-hostname",
    expect: "miss?",
  },
  {
    spec: "fresh-runtime-exfil-ip@1.0.0",
    label: "malicious",
    type: "runtime-ip-exfil",
    expect: "catch",
  },
  { spec: "fresh-wget-pipe@1.0.0", label: "malicious", type: "wget-pipe-sh", expect: "catch" },
  { spec: "fresh-node-e-exfil@1.0.0", label: "malicious", type: "node-e-inline", expect: "catch" },
  { spec: "fresh-imds-gcp@1.0.0", label: "malicious", type: "imds-gcp-hostname", expect: "catch" },
  { spec: "fresh-secret-ssh@1.0.0", label: "malicious", type: "ssh-key-theft", expect: "catch" },
  {
    spec: "fresh-eval-charcode@1.0.0",
    label: "malicious",
    type: "eval-fromcharcode",
    expect: "catch",
  },
];

const BENIGN: Case[] = [
  "pino",
  "winston",
  "ioredis",
  "knex",
  "sequelize",
  "aws-sdk",
  "googleapis",
  "firebase",
  "@nestjs/core",
  "drizzle-orm",
  "tsx",
  "turbo",
  "husky",
  "lint-staged",
  "concurrently",
  "nodemailer",
  "stripe",
  "openai",
  "ethers",
  "web3",
].map((spec) => ({ spec, label: "benign" as Label, type: "real-popular" }));

const CASES = [...MAL, ...BENIGN];

async function runPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

async function main() {
  delete process.env.OPENAI_API_KEY;
  const reg = startMiniRegistry(0, { proxy: true, only: true, fixtures: FRESH_ATTACKS });
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  const { checkPackage } = await import("../src/engine.ts");
  const cache = new VerdictCache(":memory:");
  process.stderr.write(`Generalization: ${CASES.length} fresh cases (no LLM)...\n`);

  const results = await runPool(CASES, 3, async (c) => {
    try {
      const v = await checkPackage(c.spec, { cache });
      return { ...c, verdict: v.verdict, score: v.risk_score, categories: v.categories };
    } catch (e) {
      return {
        ...c,
        verdict: "error" as const,
        score: 0,
        categories: [] as string[],
        err: (e as Error).message,
      };
    }
  });
  reg.stop();

  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  const misses: typeof results = [],
    falseAlarms: typeof results = [];
  for (const r of results) {
    const blocked = r.verdict === "block";
    if (r.label === "malicious") {
      if (blocked) tp++;
      else {
        fn++;
        misses.push(r);
      }
    } else {
      if (blocked) {
        fp++;
        falseAlarms.push(r);
      } else tn++;
    }
  }
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");

  const L: string[] = [];
  L.push("# WNPM — Generalization Pressure-Test (fresh, untuned batch)\n");
  L.push(`Fresh attacks: ${MAL.length} · fresh real benign: ${BENIGN.length}. No LLM.\n`);
  L.push("## Matrix (positive = should block)\n```");
  L.push(`malicious   TP=${tp}   FN=${fn}`);
  L.push(`benign      FP=${fp}   TN=${tn}`);
  L.push("```");
  L.push(`- Recall on UNSEEN attacks (blocked): **${pct(tp, tp + fn)}**`);
  L.push(`- Specificity on unseen real packages: **${pct(tn, tn + fp)}**\n`);
  L.push("## Misses (generalization gaps)\n");
  for (const r of misses)
    L.push(
      `- **${r.type}** \`${r.spec}\` -> ${r.verdict.toUpperCase()} (score ${r.score}) [${r.categories.join(",")}]`,
    );
  if (!misses.length) L.push("_(none)_");
  L.push("\n## False alarms\n");
  for (const r of falseAlarms) L.push(`- \`${r.spec}\` -> BLOCK [${r.categories.join(",")}]`);
  if (!falseAlarms.length) L.push("_(none)_");
  L.push("\n## All results\n| spec | label | type | expected | verdict | categories |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results)
    L.push(
      `| ${r.spec} | ${r.label} | ${r.type} | ${(r as Case).expect ?? "-"} | ${r.verdict} | ${r.categories.join(",")} |`,
    );
  process.stdout.write(`${L.join("\n")}\n`);

  process.stderr.write(
    `\nDONE. TP=${tp} FP=${fp} TN=${tn} FN=${fn} | recall(unseen)=${pct(tp, tp + fn)} specificity=${pct(tn, tn + fp)} | misses=${misses.length} falseAlarms=${falseAlarms.length}\n`,
  );
}
main();
