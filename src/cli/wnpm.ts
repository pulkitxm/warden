import { EXIT, exitCodeFor, VERDICT_JSON_SCHEMA, type Verdict } from "../schema.ts";
import { parseArgsSafe } from "../shared/args.ts";
import type { RunDeps } from "../shared/deps.ts";
import { guarded } from "../shared/errors.ts";
import {
  detectManager,
  execCommand,
  installCommand,
  MANAGER_NAMES,
  MANAGER_OPTIONS,
  managerFlag,
  type PackageManager,
} from "../shared/manager.ts";
import { progressCount, progressStep } from "../shared/progress.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import { defaultDeps } from "./deps.ts";
import { bold, dim, renderLine, renderVerdict } from "./ui.ts";

function existsFor(deps: RunDeps, path: string): boolean {
  try {
    deps.readFile(path);
    return true;
  } catch {
    return false;
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

const WNPM_HELP = `wnpm: vets packages with Warden before installing

usage:
  wnpm [--npm|--pnpm|--yarn|--bun] install [packages...] [--json] [--allow-risky]
  wnpm doctor [--dir <path>] [--json] [--no-apply] [--no-verify]

manager flags:
  --npm --pnpm --yarn --bun   install with that manager instead of the detected one

doctor flags:
  --dir <path>   project directory (default .)
  --json         write the doctor report JSON to stdout
  --no-apply     report and plan only, do not modify package.json
  --no-verify    skip isolated-workspace verification of plans

exit codes: 0 clean or fully fixed - 10 unresolved issues - 30 error
`;

export async function runWnpm(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const parsed = parseArgsSafe({
    args: argv,
    options: {
      json: { type: "boolean" },
      "allow-risky": { type: "boolean" },
      "no-apply": { type: "boolean" },
      "no-verify": { type: "boolean" },
      dir: { type: "string" },
      help: { type: "boolean" },
      ...MANAGER_OPTIONS,
    },
    allowPositionals: true,
  });
  if (!parsed) {
    deps.stderr(
      "usage: wnpm [--npm|--pnpm|--yarn|--bun] install [packages...] [--json] [--allow-risky] | wnpm doctor [--dir path] [--json] [--no-apply] [--no-verify]\n",
    );
    return 2;
  }
  const { values, positionals } = parsed;

  const verb = positionals[0];
  if (values.help || verb === "help") {
    deps.stderr(WNPM_HELP);
    return 0;
  }
  if (verb === "doctor") return runDoctorCommand("wnpm doctor", values, deps);
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
    let done = 0;
    progressStep(`vetting ${targets.length} package(s)`);
    await Promise.all(
      Array.from({ length: Math.min(LIMIT, targets.length) }, async () => {
        while (next < targets.length) {
          const idx = next++;
          verdicts[idx] = await deps.check(targets[idx]!);
          progressCount(++done, targets.length);
        }
      }),
    );

    if (values.json) {
      deps.stdout(`${JSON.stringify(verdicts)}\n`);
    } else {
      for (const level of ["block", "warn", "allow"] as const) {
        for (const v of verdicts.filter((x) => x.verdict === level))
          deps.stderr(`${renderLine(v)}\n`);
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

    const detection = detectManager(
      { readFile: deps.readFile, exists: (path) => existsFor(deps, path), which: deps.which },
      ".",
      managerFlag(values),
    );
    const command = installCommand(detection.manager, explicit, true);
    deps.stderr(
      dim(
        `\nvetted; installing via ${detection.manager} (${detection.evidence}) with lifecycle scripts disabled...\n`,
      ),
    );
    return deps.spawn(command);
  });
}

const WNPX_USAGE =
  "usage: wnpx [--npm|--pnpm|--yarn|--bun] <pkg[@version]> [--json] [--allow-risky]\n";

export async function runWnpx(argv: string[], deps: RunDeps = defaultDeps): Promise<number> {
  const managerFlags = MANAGER_NAMES.map((name) => `--${name}`);
  const own = new Set(["--json", "--allow-risky", "--schema", ...managerFlags]);
  const values = { json: false, "allow-risky": false, schema: false };
  let runner: PackageManager | undefined;
  let specIndex = -1;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (!arg.startsWith("-")) {
      if (specIndex === -1) specIndex = index;
      continue;
    }
    if (own.has(arg)) {
      if (arg === "--json") values.json = true;
      if (arg === "--allow-risky") values["allow-risky"] = true;
      if (arg === "--schema") values.schema = true;
      if (managerFlags.includes(arg)) runner = arg.slice(2) as PackageManager;
      continue;
    }
    if (specIndex === -1) {
      deps.stderr(WNPX_USAGE);
      return 2;
    }
  }

  if (values.schema) {
    deps.stdout(`${JSON.stringify(VERDICT_JSON_SCHEMA, null, 2)}\n`);
    return 0;
  }

  const spec = specIndex === -1 ? undefined : (argv[specIndex] as string);
  if (!spec) {
    deps.stderr(WNPX_USAGE);
    return 2;
  }
  const positionals = argv.slice(specIndex).filter((arg) => !own.has(arg));

  return guarded("wnpx", deps, async () => {
    const verdict = await deps.check(spec);

    if (values.json) {
      deps.stdout(`${JSON.stringify(verdict)}\n`);
      return exitCodeFor(verdict.verdict);
    }

    deps.stderr(renderVerdict(verdict));
    if (verdict.verdict === "block" && !values["allow-risky"]) {
      deps.stderr(
        dim("refusing to run a blocked package; re-run with --allow-risky to override\n"),
      );
      return EXIT.block;
    }
    const via = runner ?? (deps.which("npx") ? "npm" : "bun");
    const command = execCommand(via, spec, positionals.slice(1));
    deps.stderr(dim(`vetted; executing via ${command[0]}...\n`));
    return deps.spawn(command);
  });
}
