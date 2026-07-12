import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseCommand } from "../adapters/parseCommand.js";
import { checkPackage } from "../engine.js";
import type { Verdict } from "../types.js";
import { llmStats } from "../verdict/index.js";
import { bold, dim, renderVerdict, renderVerdictLine } from "./render.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface MainDeps {
  spawn?: typeof spawnSync;
  readInput?: () => Promise<string>;
  readPackageJson?: () => string;
}

export interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  passthrough: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const passthrough: string[] = [];
  let afterSep = false;
  for (const a of argv) {
    if (afterSep) passthrough.push(a);
    else if (a === "--") afterSep = true;
    else if (a.startsWith("--")) flags.add(a.slice(2));
    else positional.push(a);
  }
  return { positional, flags, passthrough };
}

function directDependencies(readPackageJson: () => string): string[] {
  try {
    const pkg = JSON.parse(readPackageJson()) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return [];
  }
}

async function cmdCheck(args: ParsedArgs): Promise<number> {
  const specs = args.positional;
  if (!specs.length) throw new UsageError("usage: warden check <pkg[@version]> [--json]");
  const json = args.flags.has("json");
  const verdicts: Verdict[] = [];
  for (const spec of specs) {
    verdicts.push(await checkPackage(spec, { skipEnrichment: args.flags.has("no-enrich") }));
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify(verdicts.length === 1 ? verdicts[0] : verdicts, null, 2)}\n`,
    );
  } else {
    for (const v of verdicts) process.stdout.write(renderVerdict(v));
  }
  const blocked = verdicts.some((v) => v.level === "HIGH");
  return blocked && !args.flags.has("allow-risky") ? 1 : 0;
}

async function cmdNpx(args: ParsedArgs): Promise<number> {
  const spec = args.positional[0];
  if (!spec) throw new UsageError("usage: warden npx <pkg[@version]> [--json]");
  const verdict = await checkPackage(spec);

  if (args.flags.has("json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          package: verdict.package,
          risk_score: verdict.risk_score,
          level: verdict.level,
          flags: verdict.flags,
          recommendation: verdict.recommendation,
        },
        null,
        2,
      )}\n`,
    );
    return verdict.level === "HIGH" ? 1 : 0;
  }

  process.stdout.write(renderVerdict(verdict));
  if (verdict.level === "HIGH" && !args.flags.has("allow-risky")) {
    process.stdout.write(
      dim("Refusing to run a HIGH-risk package. Re-run with --allow-risky to override.\n"),
    );
    return 1;
  }
  process.stdout.write(dim(`(would execute: npx ${spec})\n`));
  return 0;
}

async function cmdInstall(args: ParsedArgs, deps: MainDeps): Promise<number> {
  const spawn = deps.spawn ?? spawnSync;
  const readPackageJson = deps.readPackageJson ?? (() => readFileSync("package.json", "utf8"));
  const explicit = args.positional;
  const targets = explicit.length ? explicit : directDependencies(readPackageJson);
  if (!targets.length) {
    throw new UsageError("nothing to install (no packages given and no package.json deps found)");
  }

  process.stdout.write(bold(`\nWarden — vetting ${targets.length} package(s) before install\n`));
  const verdicts: Verdict[] = [];
  for (const t of targets) {
    try {
      verdicts.push(await checkPackage(t));
    } catch (e) {
      process.stdout.write(dim(`  ?      ${t}  (could not resolve: ${(e as Error).message})\n`));
    }
  }

  for (const level of ["HIGH", "MEDIUM", "LOW"] as const) {
    const group = verdicts.filter((v) => v.level === level);
    for (const v of group) process.stdout.write(`${renderVerdictLine(v)}\n`);
  }

  const allowRisky = args.flags.has("allow-risky");
  const high = verdicts.filter((v) => v.level === "HIGH");
  const firstHigh = high[0];
  if (firstHigh && !allowRisky) {
    process.stdout.write(
      `\n${renderVerdict(firstHigh)}${dim(
        `Install blocked: ${high.length} HIGH-risk package(s). Override with --allow-risky.\n`,
      )}`,
    );
    return 1;
  }

  process.stdout.write(dim("\nRunning pnpm install --ignore-scripts ...\n"));
  const installArgs = ["install", "--ignore-scripts", ...explicit, ...args.passthrough];
  const res = spawn("pnpm", installArgs, { stdio: "inherit" });
  if (res.status !== 0) return res.status ?? 2;

  const cleared = verdicts
    .filter((v) => v.level !== "HIGH" || allowRisky)
    .map((v) => v.package.slice(0, v.package.lastIndexOf("@")));
  if (cleared.length) {
    process.stdout.write(
      dim(`Re-enabling lifecycle scripts for the ${cleared.length} vetted package(s) only ...\n`),
    );
    spawn("pnpm", ["rebuild", ...cleared], { stdio: "inherit" });
  } else {
    process.stdout.write(dim("No vetted packages to rebuild; lifecycle scripts stay disabled.\n"));
  }
  return 0;
}

interface StdinLike {
  isTTY?: boolean;
  setEncoding(enc: "utf8"): unknown;
  on(event: string, cb: (arg?: unknown) => void): unknown;
}

export function readStdin(stream: StdinLike = process.stdin): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => {
      data += String(c);
    });
    stream.on("end", () => resolve(data));
    if (stream.isTTY) resolve("");
  });
}

async function cmdHook(deps: MainDeps): Promise<number> {
  const readInput = deps.readInput ?? readStdin;
  let command = "";
  try {
    const input = await readInput();
    const event = JSON.parse(input) as { tool_input?: { command?: string } };
    command = event.tool_input?.command ?? "";
  } catch {
    return 0;
  }

  const parsed = command ? parseCommand(command) : null;
  if (!parsed || parsed.packages.length === 0) return 0;

  const blockers: Verdict[] = [];
  for (const spec of parsed.packages) {
    try {
      const v = await checkPackage(spec);
      if (v.level === "HIGH") blockers.push(v);
    } catch {}
  }

  if (blockers.length === 0) return 0;

  const reason = blockers
    .map((v) => `${v.package} — ${v.explanation} [flags: ${v.flags.join(", ")}]`)
    .join("\n");
  const decision = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Warden blocked a HIGH-risk package:\n${reason}\nDo not retry the same package or attempt to bypass this hook. Pick a safe alternative (the evidence names any impersonated package) or ask the user how to proceed; only a human can override, by installing outside the agent or removing the Warden hook.`,
    },
  };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  return 0;
}

export const HELP = `warden — a trust layer for npm that thinks before it executes

usage:
  warden check <pkg[@version]>... [--json] [--no-enrich] [--allow-risky]
  warden npx   <pkg[@version]>    [--json] [--allow-risky]
  warden install [pkgs...]        [--allow-risky] [-- <pnpm args>]
  warden hook                     PreToolUse adapter (reads event JSON on stdin)

flags:
  --json         machine-readable output (for agents)
  --allow-risky  override a HIGH-risk block
  --no-enrich    skip OSV/deps.dev network enrichment
`;

export async function run(argv: string[], deps: MainDeps = {}): Promise<number> {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  let code = 0;
  switch (cmd) {
    case "check":
      code = await cmdCheck(args);
      break;
    case "npx":
      code = await cmdNpx(args);
      break;
    case "install":
    case "i":
    case "add":
      code = await cmdInstall(args, deps);
      break;
    case "hook":
      code = await cmdHook(deps);
      break;
    case "help":
    case undefined:
    case "--help":
      process.stdout.write(HELP);
      break;
    default:
      throw new UsageError(`unknown command "${cmd}". Run "warden help".`);
  }
  if (process.env.WARDEN_DEBUG) {
    process.stderr.write(dim(`\n[warden] llm calls this run: ${llmStats.calls}\n`));
  }
  return code;
}
