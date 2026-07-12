/**
 * Testable CLI cores for wnpm and wnpx. The bin entries (wnpm.ts / wnpx.ts) are
 * shims that do `process.exit(await runX(Bun.argv.slice(2)))`; all logic lives
 * here so tests can inject effects (no real installs, no process.exit).
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { checkPackage } from "./engine.ts";
import { renderVerdict, renderLine, bold, dim } from "./ui.ts";
import { exitCodeFor, VERDICT_JSON_SCHEMA, EXIT, type Verdict } from "@warden/schema";

/** Injectable effects. Tests replace these; the shims use the defaults. */
export interface RunDeps {
  check: (spec: string) => Promise<Verdict>;
  stdout: (s: string) => unknown;
  stderr: (s: string) => unknown;
  which: (cmd: string) => string | null;
  /** Run a command inheriting stdio; returns its exit code. */
  spawn: (cmd: string[]) => number;
  readFile: (path: string) => string;
}

export const defaultDeps: RunDeps = {
  check: checkPackage,
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
  which: Bun.which,
  spawn: (cmd) => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" }).exitCode ?? 0,
  readFile: (path) => readFileSync(path, "utf8"),
};

/** Shared analysis wrapper: map any engine error to EXIT.error (fail open, loudly). */
async function guarded(tool: string, deps: RunDeps, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    deps.stderr(`${tool}: analysis error: ${(e as Error).message}\n`);
    return EXIT.error;
  }
}

function directDeps(deps: RunDeps): string[] {
  try {
    const p = JSON.parse(deps.readFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})];
  } catch {
    return [];
  }
}

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
export async function runWnpm(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" } },
    allowPositionals: true,
  });

  // positionals[0] is the verb ("install"/"add"/"i"); the rest are packages.
  const verb = positionals[0];
  if (verb && !["install", "add", "i"].includes(verb)) {
    deps.stderr(`wnpm: unknown command "${verb}"\n`);
    return 2;
  }
  const explicit = positionals.slice(1);

  const targets = explicit.length ? explicit : directDeps(deps);
  if (!targets.length) {
    deps.stderr("wnpm: nothing to install (no packages given, no package.json deps)\n");
    return 2;
  }

  return guarded("wnpm", deps, async () => {
    deps.stderr(bold(`\nWarden — vetting ${targets.length} package(s) before install\n`));
    // Vet targets concurrently (bounded) — a real dependency list shouldn't be
    // checked one-at-a-time (issue I7). The integrity cache dedups repeats.
    const LIMIT = 8;
    const verdicts: Verdict[] = new Array(targets.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LIMIT, targets.length) }, async () => {
        while (next < targets.length) {
          const idx = next++;
          verdicts[idx] = await deps.check(targets[idx]!);
        }
      }),
    );

    if (values.json) {
      deps.stdout(JSON.stringify(verdicts) + "\n");
    } else {
      for (const level of ["block", "warn", "allow"] as const) {
        for (const v of verdicts.filter((x) => x.verdict === level)) deps.stderr(renderLine(v) + "\n");
      }
    }

    const blocked = verdicts.filter((v) => v.verdict === "block");
    if (blocked.length && !values["allow-risky"]) {
      if (!values.json) deps.stderr(renderVerdict(blocked[0]!));
      deps.stderr(dim(`\ninstall blocked: ${blocked.length} package(s) failed the trust check. Override with --allow-risky.\n`));
      return EXIT.block;
    }

    // Cleared: install with scripts disabled (block path never reaches here),
    // wrapping the project's package manager (prefer pnpm/bun, then npm — I8).
    const pm = ["pnpm", "bun", "npm"].find((p) => deps.which(p)) ?? "npm";
    const installArgs = pm === "bun" ? ["install", ...explicit] : ["install", "--ignore-scripts", ...explicit];
    deps.stderr(dim(`\nvetted; installing via ${pm} with lifecycle scripts disabled...\n`));
    return deps.spawn([pm, ...installArgs]);
  });
}

/**
 * `wnpx <pkg[@version]> [--json] [--allow-risky]`
 *
 * Agent-safe mode: with --json, writes EXACTLY ONE JSON object (the Verdict) to
 * stdout and nothing else — human output goes to stderr. A coding agent runs
 * this before executing an npx command and gates on `verdict`.
 *
 * Exit: 0 allow · 10 warn · 20 block · 30 analysis error.
 */
export async function runWnpx(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" }, schema: { type: "boolean" } },
    allowPositionals: true,
  });

  if (values.schema) {
    deps.stdout(JSON.stringify(VERDICT_JSON_SCHEMA, null, 2) + "\n");
    return 0;
  }

  const spec = positionals[0];
  if (!spec) {
    deps.stderr("usage: wnpx <pkg[@version]> [--json] [--allow-risky]\n");
    return 2;
  }

  return guarded("wnpx", deps, async () => {
    const verdict = await deps.check(spec);

    if (values.json) {
      deps.stdout(JSON.stringify(verdict) + "\n");
      return exitCodeFor(verdict.verdict);
    }

    deps.stderr(renderVerdict(verdict));
    if (verdict.verdict === "block" && !values["allow-risky"]) {
      deps.stderr(dim("refusing to run a blocked package; re-run with --allow-risky to override\n"));
      return EXIT.block;
    }
    deps.stderr(dim(`(would execute: npx ${spec})\n`));
    return exitCodeFor(verdict.verdict === "block" ? "warn" : verdict.verdict);
  });
}
