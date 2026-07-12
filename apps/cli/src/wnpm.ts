#!/usr/bin/env bun
/**
 * `wnpm install [pkgs...] [--allow-risky] [--json]`
 *
 * Vets every target before install. Blocks if any package is BLOCK unless
 * --allow-risky. On clearance, installs with lifecycle scripts disabled (Bun /
 * npm already move this way). Human output to stderr; --json emits the verdict
 * array on stdout.
 *
 * Exit: 0 allow · 10 warn · 20 block · 30 error.
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { checkPackage } from "./engine.ts";
import { renderVerdict, renderLine, bold, dim } from "./ui.ts";
import { EXIT, type Verdict } from "@warden/schema";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" } },
  allowPositionals: true,
});

// positionals[0] is the verb ("install"/"add"/"i"); the rest are packages.
const verb = positionals[0];
if (verb && !["install", "add", "i"].includes(verb)) {
  process.stderr.write(`wnpm: unknown command "${verb}"\n`);
  process.exit(2);
}
const explicit = positionals.slice(1);

function directDeps(): string[] {
  try {
    const p = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})];
  } catch {
    return [];
  }
}

const targets = explicit.length ? explicit : directDeps();
if (!targets.length) {
  process.stderr.write("wnpm: nothing to install (no packages given, no package.json deps)\n");
  process.exit(2);
}

try {
  process.stderr.write(bold(`\nWarden — vetting ${targets.length} package(s) before install\n`));
  // Vet targets concurrently (bounded) — a real dependency list shouldn't be
  // checked one-at-a-time (issue I7). The integrity cache dedups repeats.
  const LIMIT = 8;
  const verdicts: Verdict[] = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(LIMIT, targets.length) }, async () => {
      while (next < targets.length) {
        const idx = next++;
        verdicts[idx] = await checkPackage(targets[idx]!);
      }
    }),
  );

  if (values.json) {
    process.stdout.write(JSON.stringify(verdicts) + "\n");
  } else {
    for (const level of ["block", "warn", "allow"] as const) {
      for (const v of verdicts.filter((x) => x.verdict === level)) process.stderr.write(renderLine(v) + "\n");
    }
  }

  const blocked = verdicts.filter((v) => v.verdict === "block");
  if (blocked.length && !values["allow-risky"]) {
    if (!values.json) process.stderr.write(renderVerdict(blocked[0]!));
    process.stderr.write(dim(`\ninstall blocked: ${blocked.length} package(s) failed the trust check. Override with --allow-risky.\n`));
    process.exit(EXIT.block);
  }

  // Cleared: install with scripts disabled (block path never reaches here),
  // wrapping the project's package manager (prefer pnpm/bun, then npm — I8).
  const pm = ["pnpm", "bun", "npm"].find((p) => Bun.which(p)) ?? "npm";
  const installArgs = pm === "bun" ? ["install", ...explicit] : ["install", "--ignore-scripts", ...explicit];
  process.stderr.write(dim(`\nvetted; installing via ${pm} with lifecycle scripts disabled...\n`));
  const proc = Bun.spawnSync([pm, ...installArgs], { stdout: "inherit", stderr: "inherit" });
  process.exit(proc.exitCode ?? 0);
} catch (e) {
  process.stderr.write(`wnpm: analysis error: ${(e as Error).message}\n`);
  process.exit(EXIT.error);
}
