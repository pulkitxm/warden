import { join } from "node:path";
import { parseSpec } from "../../engine.ts";
import { manifestRequirements, readInstalledGraph } from "../../graph/installed.ts";
import { resolveWithManager } from "../../graph/manager-resolve.ts";
import { buildPlan, type TransactionPlan } from "../../graph/plan.ts";
import { buildRequest, type TransactionOperation } from "../../graph/request.ts";
import { resolveGraph } from "../../graph/resolve.ts";
import { fetchPackument } from "../../registry.ts";
import { EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { detectManager, MANAGER_NAMES } from "../../shared/manager.ts";
import { isQuiet } from "../../shared/output.ts";

export const PLAN_DIR = join(".warden", "plans");

export const PLAN_EXIT: Record<TransactionPlan["decision"], number> = {
  allow: EXIT.allow,
  warn: EXIT.warn,
  needs_approval: EXIT.warn,
  block: EXIT.block,
};

const DECISION_LABEL: Record<TransactionPlan["decision"], string> = {
  allow: c("32", "ALLOW"),
  warn: c("33", "WARN"),
  needs_approval: c("33", "NEEDS_APPROVAL"),
  block: c("31", "BLOCK"),
};

const RUNNERS = ["npm", "pnpm", "yarn", "bun", "npx", "bunx"];

function wordsFromArgv(argv: string[]): string[] {
  const separator = argv.indexOf("--");
  const tail = separator === -1 ? argv : argv.slice(separator + 1);
  return tail.filter((arg) => !arg.startsWith("-"));
}

export function specsFromArgv(argv: string[]): string[] {
  const words = wordsFromArgv(argv);
  const managerIndex = words.findIndex((word) => RUNNERS.includes(word));
  if (managerIndex === -1) return words;
  const verbs = new Set(["install", "i", "add", "ci", "update", "up", "require"]);
  return words.slice(managerIndex + 1).filter((word) => !verbs.has(word));
}

export function managerFromArgv(argv: string[]): string | undefined {
  const flagged = MANAGER_NAMES.find((name) => argv.includes(`--${name}`));
  return flagged ?? wordsFromArgv(argv).find((word) => RUNNERS.includes(word));
}

export function renderPlan(plan: TransactionPlan): string {
  const lines: string[] = ["", bold(`Warden plan: ${plan.command}`), ""];

  lines.push(bold("Direct changes"));
  if (plan.direct.length) {
    for (const entry of plan.direct) {
      const artifact = plan.artifacts.find((item) => item.package === entry.name);
      lines.push(`  + ${entry.name} ${artifact?.version ?? entry.range}`);
    }
  } else lines.push(dim("  none; this is a graph transaction over the existing manifest"));
  lines.push("");

  const transitive = plan.delta.added.filter((entry) => !entry.direct).length;
  lines.push(bold("Graph changes"));
  lines.push(`  + ${transitive} transitive packages`);
  lines.push(`  ~ ${plan.delta.changed.length} existing packages resolved to a different version`);
  lines.push(`  - ${plan.delta.removed.length} packages no longer required`);
  lines.push(`  = ${plan.delta.unchanged} unchanged`);
  lines.push("");

  lines.push(bold("Execution surface"));
  lines.push(`  ${plan.delta.scriptSurface.length} changed packages carry an install script`);
  lines.push(
    `  ${plan.delta.newScriptSurface.length} of those are new relative to the current graph`,
  );
  lines.push(`  ${plan.delta.platformArtifacts.length} platform-specific artifacts will be added`);
  lines.push(`  ${plan.unresolved.length} requirements did not resolve from the registry`);
  lines.push("");

  lines.push(bold("Analysis coverage"));
  const percent = Math.round(plan.coverage.ratio * 100);
  lines.push(
    `  ${plan.coverage.analyzed} of ${plan.coverage.changed} changed packages analyzed (${percent}%)`,
  );
  if (plan.truncated) lines.push(dim("  the graph was truncated; coverage is incomplete"));
  lines.push("");

  lines.push(`${bold("Decision:")} ${DECISION_LABEL[plan.decision]}`);
  for (const reason of plan.reasons.slice(0, 8)) lines.push(`  ${reason}`);
  if (plan.reasons.length > 8) lines.push(dim(`  and ${plan.reasons.length - 8} more`));
  lines.push("");

  lines.push(bold("Next action"));
  for (const action of plan.next_actions.slice(0, 5)) lines.push(`  ${action}`);
  lines.push("");
  lines.push(dim(`  plan ${plan.plan_id} written to ${join(PLAN_DIR, `${plan.plan_id}.json`)}`));
  lines.push("");
  return lines.join("\n");
}

export async function runWardenPlan(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const specs = specsFromArgv(argv);
  const fs = { readFile: deps.readFile, exists: deps.exists, which: deps.which };

  const direct = specs.map((spec) => {
    const parsed = parseSpec(spec);
    return { name: parsed.name, range: parsed.version ?? "latest" };
  });

  let plan: TransactionPlan;
  try {
    const installed = readInstalledGraph(fs, root);
    const existing = manifestRequirements(fs, root);
    if (!direct.length && !existing.length) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_PLAN_EMPTY",
        "nothing to plan: no packages were named and no manifest requirements were found",
        "run warden plan -- npm install <package> inside a project",
      );
    }
    const manager = detectManager(fs, root, managerFromArgv(argv)).manager;
    const separator = argv.indexOf("--");
    const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
    const managerArgv =
      passthrough[0] === manager || RUNNERS.includes(passthrough[0] ?? "")
        ? passthrough.slice(1)
        : passthrough;
    const operation: TransactionOperation = specs.length ? "add" : "install";
    const request = buildRequest({
      manager,
      operation,
      argv: managerArgv.length ? managerArgv : ["install", ...specs],
      cwd: root,
      specs,
    });
    const command = `${manager} ${request.argv.join(" ")}`.trim();
    plan = await buildPlan(
      { command, manager, request, root, direct, existing, installed },
      {
        resolve: resolveGraph,
        packument: fetchPackument,
        check: deps.check,
        resolveWithManager: () =>
          resolveWithManager(manager, request, root, {
            exists: deps.exists,
            readFile: deps.readFile,
            exec: (cmd, cwd, env) => ({ code: deps.spawnQuiet(cmd, cwd, env) }),
            mkTemp: deps.mkTemp,
            copyFile: deps.copyFile,
            rm: deps.rmrf,
            which: deps.which,
          }),
      },
    );
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_PLAN_ERROR",
      `the transaction could not be planned: ${(error as Error).message}`,
      "run warden plan from the project root, and retry once the registry is reachable",
    );
  }

  try {
    deps.mkdir(join(root, PLAN_DIR));
    deps.writeFile(
      join(root, PLAN_DIR, `${plan.plan_id}.json`),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
  } catch {
    plan.reasons.push("the plan could not be written to disk, so warden apply will not find it");
  }

  if (wantsJson) deps.stdout(`${JSON.stringify(plan)}\n`);
  else if (!isQuiet()) deps.stderr(renderPlan(plan));
  return PLAN_EXIT[plan.decision];
}
