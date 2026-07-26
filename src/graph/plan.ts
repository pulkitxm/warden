import { createHash } from "node:crypto";
import type { Verdict, VerdictLevel } from "../schema.ts";
import { progressCount, progressDetail, progressStep } from "../shared/progress.ts";
import { digestGraph, type GraphChange, type GraphDelta, graphDelta } from "./delta.ts";
import type { InstalledGraph } from "./installed.ts";
import type { GraphResolution, RootRequirement, resolveGraph } from "./resolve.ts";

export type PlanDecision = "allow" | "warn" | "needs_approval" | "block";

export interface PlanArtifact {
  package: string;
  version: string;
  integrity?: string;
  verdict: VerdictLevel | "unchecked" | "unanalyzable";
  summary: string;
  categories: string[];
}

export interface TransactionPlan {
  schema_version: 1;
  plan_id: string;
  command: string;
  manager: string;
  root: string;
  direct: Array<{ name: string; range: string }>;
  graph_before: string;
  graph_after: string;
  delta: GraphDelta;
  artifacts: PlanArtifact[];
  unresolved: GraphResolution["unresolved"];
  conflicts: GraphResolution["conflicts"];
  truncated: boolean;
  coverage: { analyzed: number; changed: number; ratio: number };
  decision: PlanDecision;
  reasons: string[];
  next_actions: string[];
}

export interface PlanDeps {
  resolve: typeof resolveGraph;
  packument: Parameters<typeof resolveGraph>[1]["packument"];
  check: (spec: string) => Promise<Verdict>;
  maxNodes?: number;
  maxChecks?: number;
  concurrency?: number;
}

export interface PlanInput {
  command: string;
  manager: string;
  root: string;
  direct: RootRequirement[];
  existing: RootRequirement[];
  installed: InstalledGraph;
}

const DEFAULT_MAX_CHECKS = 400;
const DEFAULT_CONCURRENCY = 8;

function planId(command: string, graphAfter: string): string {
  const digest = createHash("sha256").update(`${command}\n${graphAfter}`).digest("hex");
  return `wtxn_${digest.slice(0, 16)}`;
}

async function vet(
  changes: GraphChange[],
  deps: PlanDeps,
): Promise<{ artifacts: PlanArtifact[]; analyzed: number }> {
  const budget = deps.maxChecks ?? DEFAULT_MAX_CHECKS;
  const lanes = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const artifacts: PlanArtifact[] = new Array(changes.length);
  const vetting = Math.min(changes.length, budget);
  progressStep(`vetting ${vetting} changed packages`);

  let next = 0;
  let done = 0;
  let analyzed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= changes.length) return;
      const change = changes[index] as GraphChange;
      const spec = `${change.name}@${change.version}`;

      if (index >= budget) {
        artifacts[index] = {
          package: change.name,
          version: change.version,
          verdict: "unchecked",
          summary: "beyond the analysis budget for this plan",
          categories: [],
        };
        continue;
      }

      analyzed++;
      progressDetail(spec);
      try {
        const verdict = await deps.check(spec);
        artifacts[index] = {
          package: change.name,
          version: change.version,
          integrity: verdict.integrity,
          verdict: verdict.verdict,
          summary: verdict.summary,
          categories: [...verdict.categories],
        };
      } catch (error) {
        artifacts[index] = {
          package: change.name,
          version: change.version,
          verdict: "unanalyzable",
          summary: (error as Error).message,
          categories: [],
        };
      }
      progressCount(++done, vetting);
    }
  };

  await Promise.all(Array.from({ length: Math.min(lanes, changes.length) }, worker));
  return { artifacts, analyzed };
}

function decide(
  delta: GraphDelta,
  artifacts: PlanArtifact[],
  resolution: GraphResolution,
): { decision: PlanDecision; reasons: string[] } {
  const reasons: string[] = [];
  const blocked = artifacts.filter((artifact) => artifact.verdict === "block");
  for (const artifact of blocked) reasons.push(`${artifact.package}: ${artifact.summary}`);

  const failed = artifacts.filter((artifact) => artifact.verdict === "unanalyzable");
  for (const artifact of failed)
    reasons.push(`${artifact.package} could not be analyzed: ${artifact.summary}`);

  const blockingUnresolved = resolution.unresolved.filter((entry) => !entry.optional);
  for (const entry of blockingUnresolved)
    reasons.push(`${entry.name}@${entry.range} ${entry.reason}`);

  if (blocked.length || failed.length || blockingUnresolved.length)
    return { decision: "block", reasons };

  for (const change of delta.newScriptSurface)
    reasons.push(
      `${change.name}@${change.version} ${change.from ? "adds" : "has"} a ${change.newHooks.join(", ")} script`,
    );
  const unchecked = artifacts.filter((artifact) => artifact.verdict === "unchecked");
  if (unchecked.length)
    reasons.push(`${unchecked.length} changed packages were not analyzed in this plan`);
  if (resolution.truncated) reasons.push("the graph was truncated before it was fully resolved");
  if (delta.newScriptSurface.length || unchecked.length || resolution.truncated)
    return { decision: "needs_approval", reasons };

  const warned = artifacts.filter((artifact) => artifact.verdict === "warn");
  for (const artifact of warned) reasons.push(`${artifact.package}: ${artifact.summary}`);
  for (const change of delta.deprecatedIntroduced)
    reasons.push(`${change.name}@${change.version} is deprecated`);
  if (warned.length || delta.deprecatedIntroduced.length) return { decision: "warn", reasons };

  return { decision: "allow", reasons };
}

function nextActions(delta: GraphDelta, plan: { decision: PlanDecision; id: string }): string[] {
  if (plan.decision === "block") return ["warden explain <package>@<version>"];
  if (plan.decision === "needs_approval") {
    const actions = delta.newScriptSurface.map(
      (change) =>
        `warden approve-script ${change.name}@${change.version} --hook ${change.newHooks[0]} --plan ${plan.id}`,
    );
    return actions.length ? actions : [`warden apply ${plan.id}`];
  }
  return [`warden apply ${plan.id}`];
}

export async function buildPlan(input: PlanInput, deps: PlanDeps): Promise<TransactionPlan> {
  const requirements = [...input.existing, ...input.direct];
  progressStep("resolving the prospective dependency graph");
  const resolution = await deps.resolve(requirements, {
    packument: deps.packument,
    ...(deps.maxNodes === undefined ? {} : { maxNodes: deps.maxNodes }),
  });

  const directNames = new Set(input.direct.map((entry) => entry.name));
  for (const node of resolution.nodes) if (directNames.has(node.name)) node.depth = 0;

  const delta = graphDelta(resolution, input.installed.nodes);
  const changes = [...delta.added, ...delta.changed];
  const { artifacts, analyzed } = await vet(changes, deps);

  const graphBefore = digestGraph(
    [...input.installed.nodes.entries()].map(([name, node]) => ({ name, version: node.version })),
  );
  const graphAfter = digestGraph(resolution.nodes);
  const id = planId(input.command, graphAfter);
  const { decision, reasons } = decide(delta, artifacts, resolution);

  return {
    schema_version: 1,
    plan_id: id,
    command: input.command,
    manager: input.manager,
    root: input.root,
    direct: input.direct.map((entry) => ({ name: entry.name, range: entry.range })),
    graph_before: graphBefore,
    graph_after: graphAfter,
    delta,
    artifacts,
    unresolved: resolution.unresolved,
    conflicts: resolution.conflicts,
    truncated: resolution.truncated,
    coverage: {
      analyzed,
      changed: changes.length,
      ratio: changes.length ? analyzed / changes.length : 1,
    },
    decision,
    reasons,
    next_actions: nextActions(delta, { decision, id }),
  };
}
