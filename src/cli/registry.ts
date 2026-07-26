import { parseArgs } from "node:util";
import { runWardenIntent } from "../intent/index.ts";
import { ANALYZER_VERSION, EXIT } from "../schema.ts";
import type { WardenDeps } from "../shared/deps.ts";
import { wardenFailure } from "../shared/errors.ts";
import { runWardenCheck } from "./commands/check.ts";
import { runWardenCi } from "./commands/ci.ts";
import { runWardenConfig, runWardenUninstall } from "./commands/config.ts";
import { runWardenCoverage, runWardenShimPlan } from "./commands/coverage.ts";
import { runWardenDetect } from "./commands/detect.ts";
import { runWardenDoctor } from "./commands/doctor.ts";
import { runWardenFix } from "./commands/fix.ts";
import { runWardenInit } from "./commands/init.ts";
import { runWardenIntegrations } from "./commands/integrations.ts";
import { runWardenLog } from "./commands/log.ts";
import { runWardenSchema } from "./commands/schema.ts";
import {
  bashCompletions,
  type CommandDefinition,
  fishCompletions,
  helpFlag,
  zshCompletions,
} from "./help.ts";
import { TRANSACTION_COMMANDS } from "./registry-transactions.ts";
import { runWnpm } from "./wnpm.ts";

export function runWardenCompletions(argv: string[], deps: WardenDeps): number {
  const shell = argv[0];
  const generators: Record<string, () => string> = {
    bash: () => bashCompletions(COMMAND_REGISTRY),
    zsh: () => zshCompletions(COMMAND_REGISTRY),
    fish: () => fishCompletions(COMMAND_REGISTRY),
  };
  if (shell && generators[shell]) {
    deps.stdout(generators[shell]());
    return EXIT.allow;
  }
  return wardenFailure(
    deps,
    true,
    "usage",
    "WARDEN_UNKNOWN_SHELL",
    `unknown completion shell "${shell ?? ""}"`,
    "run warden completions --help",
  );
}

async function runWardenSelectManagers(argv: string[], deps: WardenDeps): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { detected: { type: "string" } },
  });
  const names = (values.detected ?? "").split(/\s+/).filter(Boolean);
  if (!names.length || !deps.isTTY()) {
    deps.stdout(`${names.join(" ")}\n`);
    return EXIT.allow;
  }
  try {
    const selected = await deps.selectManagers(names);
    deps.stdout(`${selected.join(" ")}\n`);
    return EXIT.allow;
  } catch {
    deps.stderr("warden: manager selection cancelled\n");
    return EXIT.error;
  }
}

export function runWardenVersion(_argv: string[], deps: WardenDeps): number {
  deps.stdout(`${ANALYZER_VERSION}\n`);
  return EXIT.allow;
}

export const COMMAND_REGISTRY: readonly CommandDefinition[] = [
  {
    name: "check",
    description: "vet packages, the lockfile, install scripts, or registry config",
    positional: {
      kind: "<pkg[@version]... | lockfile | scripts | config>",
      values: ["lockfile", "scripts", "config"],
    },
    flags: [
      { name: "--json", description: "write verdict JSON to stdout" },
      { name: "--allow-risky", description: "permit blocked packages and exit 10" },
      { name: "--dir", valueHint: "<path>", description: "directory to audit for a surface check" },
      helpFlag,
    ],
    exitCodes: "0 allow · 10 warn · 20 block · 30 error",
    example: "warden check lockfile --json",
    run: runWardenCheck,
  },
  {
    name: "install",
    learnMore: "package-managers",
    aliases: ["i", "add"],
    description: "vet packages, then install them with lifecycle scripts suppressed",
    positional: { kind: "[pkg[@version]...]" },
    flags: [
      {
        name: "--npm|--pnpm|--yarn|--bun",
        description: "install with that manager instead of the detected one",
      },
      { name: "--json", description: "write the verdicts to stdout" },
      { name: "--allow-risky", description: "install even when a package is blocked" },
      helpFlag,
    ],
    exitCodes: "0 installed · 20 blocked · 30 error",
    example: "warden install --bun express",
    run: (argv, deps) => runWnpm(["install", ...argv], deps),
  },
  {
    name: "ci",
    learnMore: "ci",
    description: "run all checks against the merge-base diff",
    flags: [
      {
        name: "--reporter",
        valueHint: "<summary|json|github|agent|sarif>",
        description: "select human, JSON, workflow, agent, or SARIF output",
      },
      { name: "--base", valueHint: "<ref>", description: "compare against this git ref" },
      {
        name: "--intent-prompt",
        valueHint: "<text>",
        description: "also verify the diff against this prompt",
      },
      {
        name: "--require-transaction-receipt",
        description: "fail when the dependency graph changed without a valid warden receipt",
      },
      helpFlag,
    ],
    exitCodes: "0 clean · 10 warn · 20 block · 30 error",
    example: "warden ci --reporter github --base origin/main",
    run: runWardenCi,
  },
  {
    name: "doctor",
    learnMore: "doctor",
    description: "audit dependencies for CVEs, gate the fixes, verify, and apply",
    flags: [
      { name: "--dir", valueHint: "<path>", description: "project directory (default .)" },
      { name: "--json", description: "write the doctor report JSON to stdout" },
      { name: "--no-apply", description: "report and plan only, do not modify package.json" },
      { name: "--no-verify", description: "skip isolated-workspace verification of plans" },
      helpFlag,
    ],
    exitCodes: "0 clean or fully fixed · 10 unresolved issues · 30 error",
    example: "warden doctor --no-apply --json",
    run: runWardenDoctor,
  },
  {
    name: "intent",
    learnMore: "intent",
    description: "verify the diff does what the prompt asked",
    positional: { kind: "[check|extract|diff|symbols|bench|schema]" },
    flags: [
      { name: "--prompt", valueHint: "<text>", description: "the instruction the agent was given" },
      { name: "--base", valueHint: "<ref>", description: "compare against this git ref" },
      { name: "--json", description: "write the intent report JSON to stdout" },
      { name: "--offline", description: "skip the registry lookup for added imports" },
      helpFlag,
    ],
    exitCodes: "0 met · 10 partial/scope creep · 20 dropped or hallucinated · 30 error",
    example: 'warden intent check --prompt "add rate limiting to the api client"',
    run: runWardenIntent,
  },
  ...TRANSACTION_COMMANDS,
  {
    name: "coverage",
    learnMore: "coverage",
    description: "print which package-manager commands warden mediates",
    flags: [{ name: "--json", description: "write the coverage matrix to stdout" }, helpFlag],
    exitCodes: "0 success",
    example: "warden coverage --json",
    run: runWardenCoverage,
  },
  {
    name: "shim-plan",
    description: "classify a package-manager command for the shim",
    hidden: true,
    flags: [],
    exitCodes: "0 success",
    example: "warden shim-plan npm ci",
    run: runWardenShimPlan,
  },
  {
    name: "integrations",
    learnMore: "troubleshooting",
    description: "check that the shims, agents, and CI wiring actually work",
    positional: { kind: "[doctor]", values: ["doctor"] },
    flags: [{ name: "--json", description: "write the integrations report to stdout" }, helpFlag],
    exitCodes: "0 healthy · 30 a check failed",
    example: "warden integrations doctor",
    run: runWardenIntegrations,
  },
  {
    name: "detect",
    description: "classify the workspace (framework, role, tooling per package)",
    flags: [{ name: "--json", description: "write the detection manifest to stdout" }, helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden detect --json",
    run: runWardenDetect,
  },
  {
    name: "init",
    description: "onboard a repo: config, workflow, hooks, agent context",
    flags: [
      { name: "--yes", description: "accept every offered file change" },
      { name: "--json", description: "write typed errors to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden init --yes",
    run: runWardenInit,
  },
  {
    name: "handoff",
    aliases: ["fix"],
    description: "hand the last failing check to your coding agent",
    flags: [{ name: "--json", description: "write typed errors to stdout" }, helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden handoff",
    run: runWardenFix,
  },
  {
    name: "config",
    learnMore: "configuration",
    description: "read or set user-level settings (mode, intercept, agent)",
    positional: {
      kind: "[mode|intercept|agent] [value...]",
      values: ["mode", "intercept", "agent"],
    },
    flags: [{ name: "--json", description: "write config JSON to stdout" }, helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden config intercept off",
    run: runWardenConfig,
  },
  {
    name: "uninstall",
    description: "remove Warden, its shims, config, cache, and shell setup",
    flags: [helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden uninstall",
    run: runWardenUninstall,
  },
  {
    name: "log",
    description: "render recorded verdicts from ~/.warden/log.jsonl",
    flags: [
      { name: "--tail", valueHint: "N", description: "show only the last N entries" },
      { name: "--json", description: "write raw JSON objects to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden log --tail 20",
    run: runWardenLog,
  },
  {
    name: "schema",
    learnMore: "schemas",
    description: "print the JSON schema for structured output",
    positional: {
      kind: "[check|ci|audit|doctor|intent|list]",
      values: ["check", "ci", "audit", "doctor", "intent", "list"],
    },
    flags: [helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden schema doctor",
    run: runWardenSchema,
  },
  {
    name: "completions",
    description: "print a shell completion script",
    positional: { kind: "<bash|zsh|fish>", values: ["bash", "zsh", "fish"] },
    flags: [helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden completions zsh",
    run: runWardenCompletions,
  },
  {
    name: "version",
    description: "print the warden version",
    flags: [helpFlag],
    exitCodes: "0 success",
    example: "warden --version",
    run: runWardenVersion,
  },
  {
    name: "select-managers",
    description: "select detected package managers",
    flags: [{ name: "--detected", valueHint: "<names>", description: "detected managers" }],
    exitCodes: "0 success · 30 error",
    example: 'warden select-managers --detected "npm bun pnpm"',
    hidden: true,
    run: runWardenSelectManagers,
  },
];
