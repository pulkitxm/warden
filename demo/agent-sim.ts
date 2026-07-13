#!/usr/bin/env bun

import { readFileSync } from "node:fs";

const skillPath = Bun.argv[2] ?? "demo/skill-file/AGENTS.md";
const skill = readFileSync(skillPath, "utf8");

const m = skill.match(/npx\s+([^\s`]+)/);
if (!m) {
  console.log("agent: no npx command found in skill file; nothing to run.");
  process.exit(0);
}
const pkg = m[1]!;
console.log(`agent: the skill file wants me to run \`npx ${pkg}\`.`);
console.log(`agent: per repo policy, vetting with WNPM first: wnpx ${pkg} --json`);

const proc = Bun.spawnSync(["bun", "src/bin/wnpx.ts", pkg, "--json"], {
  stdout: "pipe",
  stderr: "ignore",
  env: process.env,
});
const verdict = JSON.parse(proc.stdout.toString().trim()) as {
  verdict: string;
  categories: string[];
  summary: string;
};

console.log("");
if (verdict.verdict === "block") {
  console.log(`agent: I will NOT run \`npx ${pkg}\`.`);
  console.log(`agent: WNPM verdict = BLOCK [${verdict.categories.join(", ")}].`);
  console.log(`agent: ${verdict.summary}`);
  console.log(`agent: stopping and reporting this to you instead of executing.`);
  process.exit(1);
} else if (verdict.verdict === "warn") {
  console.log(`agent: WNPM flagged \`${pkg}\` (WARN): ${verdict.summary}`);
  console.log(`agent: asking the user to confirm before proceeding.`);
} else {
  console.log(`agent: WNPM cleared \`${pkg}\` (ALLOW). Proceeding with \`npx ${pkg}\`.`);
}
