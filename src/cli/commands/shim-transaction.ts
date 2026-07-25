import { parseSpec } from "../../engine.ts";
import { manifestRequirements, readInstalledGraph } from "../../graph/installed.ts";
import { buildPlan, type TransactionPlan } from "../../graph/plan.ts";
import { resolveGraph } from "../../graph/resolve.ts";
import { fetchPackument } from "../../registry.ts";
import { EXIT } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { type Manager, planCommand } from "../../shim/grammar.ts";

const MANAGERS: Manager[] = ["npm", "pnpm", "yarn", "bun", "npx", "bunx"];
const GATED = new Set(["install", "frozen-install", "global-install"]);

export interface ShimTransaction {
  decision: TransactionPlan["decision"] | "skipped";
  exit: number;
  planId: string;
  added: number;
  changed: number;
  removed: number;
  analyzed: number;
  changedTotal: number;
  pendingScripts: string[];
  reasons: string[];
}

const SKIPPED: ShimTransaction = {
  decision: "skipped",
  exit: EXIT.allow,
  planId: "",
  added: 0,
  changed: 0,
  removed: 0,
  analyzed: 0,
  changedTotal: 0,
  pendingScripts: [],
  reasons: [],
};

function exitFor(decision: TransactionPlan["decision"]): number {
  if (decision === "block") return EXIT.block;
  if (decision === "allow") return EXIT.allow;
  return EXIT.warn;
}

export async function runWardenShimTransaction(argv: string[], deps: WardenDeps): Promise<number> {
  const emit = (payload: ShimTransaction) => {
    deps.stdout(`${JSON.stringify(payload)}\n`);
    return EXIT.allow;
  };

  const manager = argv[0] as Manager;
  if (!MANAGERS.includes(manager)) return emit(SKIPPED);

  const classified = planCommand(manager, argv.slice(1));
  if (!GATED.has(classified.kind)) return emit(SKIPPED);

  const root = deps.cwd();
  const fs = { readFile: deps.readFile, exists: deps.exists, which: deps.which };

  let plan: TransactionPlan;
  try {
    const installed = readInstalledGraph(fs, root);
    const existing = manifestRequirements(fs, root);
    const direct = classified.specs.map((spec) => {
      const parsed = parseSpec(spec);
      return { name: parsed.name, range: parsed.version ?? "latest" };
    });
    if (!direct.length && !existing.length) return emit(SKIPPED);

    plan = await buildPlan(
      {
        command: `${manager} ${argv.slice(1).join(" ")}`.trim(),
        manager,
        root,
        direct,
        existing,
        installed,
      },
      { resolve: resolveGraph, packument: fetchPackument, check: deps.check },
    );
  } catch (error) {
    return emit({
      ...SKIPPED,
      decision: "block",
      exit: EXIT.error,
      reasons: [`the transaction could not be planned: ${(error as Error).message}`],
    });
  }

  return emit({
    decision: plan.decision,
    exit: exitFor(plan.decision),
    planId: plan.plan_id,
    added: plan.delta.added.length,
    changed: plan.delta.changed.length,
    removed: plan.delta.removed.length,
    analyzed: plan.coverage.analyzed,
    changedTotal: plan.coverage.changed,
    pendingScripts: plan.delta.newScriptSurface.map(
      (entry) => `${entry.name}@${entry.version} ${entry.newHooks.join(",")}`,
    ),
    reasons: plan.reasons.slice(0, 6),
  });
}
