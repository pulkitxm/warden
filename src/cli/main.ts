import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkPackage } from "../engine.ts";
import { EXIT, exitCodeFor, VERDICT_JSON_SCHEMA, type Verdict } from "../schema.ts";
import { bold, dim, renderLine, renderVerdict } from "./ui.ts";

export interface RunDeps {
  check: (spec: string) => Promise<Verdict>;
  stdout: (s: string) => unknown;
  stderr: (s: string) => unknown;
  which: (cmd: string) => string | null;
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

export async function runWnpm(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" } },
    allowPositionals: true,
  });

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
        for (const v of verdicts.filter((x) => x.verdict === level))
          deps.stderr(renderLine(v) + "\n");
      }
    }

    const blocked = verdicts.filter((v) => v.verdict === "block");
    if (blocked.length && !values["allow-risky"]) {
      if (!values.json) deps.stderr(renderVerdict(blocked[0]!));
      deps.stderr(
        dim(
          `\ninstall blocked: ${blocked.length} package(s) failed the trust check. Override with --allow-risky.\n`,
        ),
      );
      return EXIT.block;
    }

    const pm = ["pnpm", "bun", "npm"].find((p) => deps.which(p)) ?? "npm";
    const installArgs =
      pm === "bun" ? ["install", ...explicit] : ["install", "--ignore-scripts", ...explicit];
    deps.stderr(dim(`\nvetted; installing via ${pm} with lifecycle scripts disabled...\n`));
    return deps.spawn([pm, ...installArgs]);
  });
}

export async function runWnpx(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      "allow-risky": { type: "boolean" },
      schema: { type: "boolean" },
    },
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
      deps.stderr(
        dim("refusing to run a blocked package; re-run with --allow-risky to override\n"),
      );
      return EXIT.block;
    }
    deps.stderr(dim(`(would execute: npx ${spec})\n`));
    return exitCodeFor(verdict.verdict === "block" ? "warn" : verdict.verdict);
  });
}
