import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

export interface WardenDeps extends RunDeps {
  home: string;
  mkdir: (path: string) => unknown;
  writeFile: (path: string, data: string) => unknown;
}

export const defaultDeps: RunDeps = {
  check: checkPackage,
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
  which: Bun.which,
  spawn: (cmd) => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" }).exitCode ?? 0,
  readFile: (path) => readFileSync(path, "utf8"),
};

export const defaultWardenDeps: WardenDeps = {
  ...defaultDeps,
  home: homedir(),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: writeFileSync,
};

const WARDEN_HELP = `warden: vets packages and enforces repo policy before code runs

usage: warden <verb> [flags]

  check    vet packages, the lockfile, scripts, or registry config
  ci       run all checks against the merge-base diff
  detect   classify the workspace (framework, role, tooling per package)
  init     onboard a repo: config, workflow, hooks, agent context
  fix      hand the last failing check to your coding agent
  config   read or set user-level settings (mode, intercept, agent)
  log      render recorded verdicts from ~/.warden/log.jsonl
  schema   print the JSON schema for a verb's output

exit codes: 0 allow · 10 warn · 20 block · 30 error
docs: https://github.com/pulkitxm/warden
`;

const CHECK_HELP = `warden check: vet one or more packages before code runs

usage: warden check <pkg[@version]...> [--json] [--allow-risky]

  --json         write verdict JSON to stdout
  --allow-risky  permit blocked packages and exit 10
  --help         show this help

exit codes: 0 allow · 10 warn · 20 block · 30 error
example: warden check express@5 left-pad --json
`;

const CONFIG_HELP = `warden config: read or set user-level settings

usage: warden config [--json]
       warden config mode <verbose|brief|block|log>
       warden config intercept [install|exec] <on|off>

  --json  write config JSON to stdout
  --help  show this help

exit codes: 0 success · 30 error
example: warden config intercept off
`;

interface UserConfig {
  mode: "verbose" | "brief" | "block" | "log";
  intercept: { install: boolean; exec: boolean };
}

const initialConfig = (): UserConfig => ({
  mode: "brief",
  intercept: { install: true, exec: true },
});

function wardenFailure(
  deps: WardenDeps,
  json: boolean,
  kind: "usage" | "analysis" | "config",
  code: string,
  reason: string,
  hint: string,
): number {
  if (json) deps.stdout(`${JSON.stringify({ error: { kind, code, reason, hint } })}\n`);
  else deps.stderr(`warden: ${reason}\nhint: ${hint}\n`);
  return EXIT.error;
}

function configPath(deps: WardenDeps): string {
  return `${deps.home}/.warden/config.json`;
}

function readConfig(deps: WardenDeps): UserConfig {
  let raw: string;
  try {
    raw = deps.readFile(configPath(deps));
  } catch {
    return initialConfig();
  }
  const value = JSON.parse(raw) as Partial<UserConfig>;
  const modes = ["verbose", "brief", "block", "log"];
  if (
    !modes.includes(value.mode ?? "") ||
    typeof value.intercept?.install !== "boolean" ||
    typeof value.intercept.exec !== "boolean"
  ) {
    throw new Error("invalid user config");
  }
  return value as UserConfig;
}

function writeConfig(deps: WardenDeps, config: UserConfig): void {
  deps.mkdir(`${deps.home}/.warden`);
  deps.writeFile(configPath(deps), `${JSON.stringify(config, null, 2)}\n`);
}

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
    deps.stderr(bold(`\nWarden: vetting ${targets.length} package(s) before install\n`));
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

async function runWardenCheck(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  if (argv.includes("--help")) {
    deps.stderr(CHECK_HELP);
    return EXIT.allow;
  }
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" } },
      allowPositionals: true,
    });
    if (!positionals.length) {
      return wardenFailure(
        deps,
        Boolean(values.json),
        "usage",
        "WARDEN_MISSING_PACKAGE",
        "check requires at least one package",
        "run warden check --help",
      );
    }
    const verdicts = await Promise.all(positionals.map((spec) => deps.check(spec)));
    if (values.json) {
      deps.stdout(`${JSON.stringify(verdicts.length === 1 ? verdicts[0] : verdicts)}\n`);
    } else if (verdicts.length === 1) {
      deps.stderr(renderVerdict(verdicts[0]!));
    } else {
      for (const verdict of verdicts) deps.stderr(`${renderLine(verdict)}\n`);
    }
    const level = verdicts.some((v) => v.verdict === "block")
      ? "block"
      : verdicts.some((v) => v.verdict === "warn")
        ? "warn"
        : "allow";
    return exitCodeFor(level === "block" && values["allow-risky"] ? "warn" : level);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_ANALYSIS_ERROR",
      (error as Error).message,
      "retry the check or verify the package spec and registry connection",
    );
  }
}

function runWardenConfig(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  if (argv.includes("--help")) {
    deps.stderr(CONFIG_HELP);
    return EXIT.allow;
  }
  try {
    const args = argv.filter((arg) => arg !== "--json");
    const config = readConfig(deps);
    if (!args.length) {
      if (wantsJson) deps.stdout(`${JSON.stringify(config)}\n`);
      else deps.stderr(`${JSON.stringify(config, null, 2)}\n`);
      return EXIT.allow;
    }
    if (args[0] === "mode" && args.length === 2) {
      if (!["verbose", "brief", "block", "log"].includes(args[1]!)) {
        throw new Error(`invalid mode "${args[1]}"`);
      }
      config.mode = args[1] as UserConfig["mode"];
      writeConfig(deps, config);
      deps.stderr(`reporting mode set to ${config.mode}\n`);
      return EXIT.allow;
    }
    if (args[0] === "intercept") {
      const scope = args.length === 3 ? args[1] : "all";
      const state = args.length === 3 ? args[2] : args[1];
      if (
        !state ||
        !["on", "off"].includes(state) ||
        !["all", "install", "exec"].includes(scope!)
      ) {
        throw new Error("invalid intercept setting");
      }
      const enabled = state === "on";
      if (scope === "all" || scope === "install") config.intercept.install = enabled;
      if (scope === "all" || scope === "exec") config.intercept.exec = enabled;
      writeConfig(deps, config);
      deps.stderr(
        scope === "all"
          ? `interception ${enabled ? "enabled (install, exec)" : "disabled; shims now pass every command straight through"}\n`
          : `${scope} interception ${enabled ? "enabled" : "disabled"}\n`,
      );
      return EXIT.allow;
    }
    throw new Error("invalid config command");
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "config",
      "WARDEN_CONFIG_ERROR",
      (error as Error).message,
      "run warden config --help",
    );
  }
}

export async function runWarden(
  argv: string[],
  deps: WardenDeps = defaultWardenDeps,
): Promise<number> {
  if (!argv.length || argv[0] === "--help" || argv[0] === "help") {
    deps.stderr(WARDEN_HELP);
    return EXIT.allow;
  }
  if (argv[0] === "check") return runWardenCheck(argv.slice(1), deps);
  if (argv[0] === "config") return runWardenConfig(argv.slice(1), deps);
  return wardenFailure(
    deps,
    argv.includes("--json"),
    "usage",
    "WARDEN_UNKNOWN_VERB",
    `unknown verb "${argv[0]}"`,
    "run warden --help",
  );
}
