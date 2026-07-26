import { join } from "node:path";
import { installCommand, type PackageManager } from "../shared/manager.ts";
import { progressStep } from "../shared/progress.ts";
import { type ApprovalRequest, findApproval, type ScriptApproval } from "./approvals.ts";
import type { GraphChange } from "./delta.ts";
import type { TransactionPlan } from "./plan.ts";
import {
  policyDigest,
  type ReceiptResult,
  type TransactionReceipt,
  transactionId,
  type VerificationSteps,
} from "./receipt.ts";
import { replayCommand, requestDigest } from "./request.ts";

export interface ApplyDeps {
  exec: (cmd: string[], cwd: string, env?: Record<string, string>) => { code: number };
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => unknown;
  exists: (path: string) => boolean;
  scriptBody: (change: GraphChange, hook: string) => Promise<string>;
  approvals: ScriptApproval[];
  analyzerVersion: string;
  currentGraphDigest?: (root: string) => string;
  managerVersion?: string;
}

export interface ApplyOptions {
  verify?: boolean;
  allowUnapproved?: boolean;
  allowIncompleteAnalysis?: boolean;
  allowStalePlan?: boolean;
}

const VERIFY_STEPS: Array<keyof Omit<VerificationSteps, "install">> = [
  "test",
  "typecheck",
  "build",
];

function projectScripts(deps: ApplyDeps, root: string): Record<string, string> {
  const path = join(root, "package.json");
  if (!deps.exists(path)) return {};
  try {
    return (JSON.parse(deps.readFile(path)) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return {};
  }
}

const SNAPSHOT_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

type Snapshot = { root: string; files: Array<{ path: string; content: string | null }> };

function snapshotProject(root: string, deps: ApplyDeps): Snapshot {
  return {
    root,
    files: SNAPSHOT_FILES.map((name) => {
      const path = join(root, name);
      let content: string | null = null;
      if (deps.exists(path)) {
        try {
          content = deps.readFile(path);
        } catch {
          content = null;
        }
      }
      return { path, content };
    }),
  };
}

function restoreProject(snapshot: Snapshot, deps: ApplyDeps): void {
  for (const file of snapshot.files) {
    if (file.content === null) continue;
    try {
      deps.writeFile(file.path, file.content);
    } catch {}
  }
}

function checkPreconditions(plan: TransactionPlan, deps: ApplyDeps): string | null {
  if (!deps.currentGraphDigest) return null;
  const current = deps.currentGraphDigest(plan.root);
  if (current === plan.graph_before) return null;
  return `the project changed since this plan was made: the graph is now ${current}, the plan was made against ${plan.graph_before}`;
}

async function pendingApprovals(
  plan: TransactionPlan,
  deps: ApplyDeps,
): Promise<{ approved: ScriptApproval[]; missing: ApprovalRequest[] }> {
  const approved: ScriptApproval[] = [];
  const missing: ApprovalRequest[] = [];
  for (const change of plan.delta.newScriptSurface) {
    const artifact = plan.artifacts.find(
      (entry) => entry.package === change.name && entry.version === change.version,
    );
    for (const hook of change.newHooks) {
      const request: ApprovalRequest = {
        package: change.name,
        version: change.version,
        integrity: artifact?.integrity ?? "",
        hook,
        script: await deps.scriptBody(change, hook),
      };
      const approval = findApproval(deps.approvals, request);
      if (approval) approved.push(approval);
      else missing.push(request);
    }
  }
  return { approved, missing };
}

function refuse(
  plan: TransactionPlan,
  reason: string,
  approved: ScriptApproval[],
  deps: ApplyDeps,
): TransactionReceipt {
  return receipt(plan, deps, {
    result: "refused",
    reason,
    approvals: approved,
    verification: {
      install: "skipped",
      test: "skipped",
      typecheck: "skipped",
      build: "skipped",
    },
  });
}

function receipt(
  plan: TransactionPlan,
  deps: ApplyDeps,
  parts: {
    result: ReceiptResult;
    reason?: string;
    approvals: ScriptApproval[];
    verification: VerificationSteps;
    observedGraph?: string;
  },
): TransactionReceipt {
  return {
    schema_version: 1,
    transaction_id: transactionId(plan.plan_id, plan.graph_after),
    plan_id: plan.plan_id,
    command: plan.command,
    manager: {
      name: plan.manager,
      ...(deps.managerVersion ? { version: deps.managerVersion } : {}),
    },
    graph_before: plan.graph_before,
    graph_after: plan.graph_after,
    ...(parts.observedGraph ? { observed_graph: parts.observedGraph } : {}),
    ...(plan.request ? { request_digest: requestDigest(plan.request) } : {}),
    policy_digest: policyDigest(plan),
    artifacts: plan.artifacts,
    approvals: parts.approvals,
    suppressed_scripts: plan.delta.scriptSurface.map((change) => ({
      package: change.name,
      version: change.version,
      hooks: change.hooks,
    })),
    verification: parts.verification,
    result: parts.result,
    ...(parts.reason ? { reason: parts.reason } : {}),
    analyzer_version: deps.analyzerVersion,
  };
}

export async function applyTransaction(
  plan: TransactionPlan,
  deps: ApplyDeps,
  options: ApplyOptions = {},
): Promise<TransactionReceipt> {
  progressStep("checking script approvals against the plan");
  const { approved, missing } = await pendingApprovals(plan, deps);

  if (plan.decision === "block")
    return refuse(plan, "the plan was blocked, so there is nothing safe to apply", approved, deps);

  if (missing.length && !options.allowUnapproved) {
    const names = missing.map((entry) => `${entry.package}@${entry.version} (${entry.hook})`);
    return refuse(plan, `unapproved install scripts: ${names.join(", ")}`, approved, deps);
  }

  const unchecked = plan.artifacts.filter((artifact) => artifact.verdict === "unchecked");
  if (plan.truncated && !options.allowIncompleteAnalysis) {
    return refuse(
      plan,
      "the graph was truncated before it was fully resolved, so this plan cannot be applied as reviewed",
      approved,
      deps,
    );
  }
  if (unchecked.length && !options.allowIncompleteAnalysis) {
    return refuse(
      plan,
      `${unchecked.length} changed packages were never analyzed; a script approval does not cover incomplete analysis`,
      approved,
      deps,
    );
  }

  const preconditions = checkPreconditions(plan, deps);
  if (preconditions && !options.allowStalePlan) return refuse(plan, preconditions, approved, deps);

  const snapshot = snapshotProject(plan.root, deps);

  const replay = plan.request ? replayCommand(plan.request) : null;
  const command =
    replay?.argv ??
    installCommand(
      plan.manager as PackageManager,
      plan.direct.map((entry) => `${entry.name}@${entry.range}`),
      true,
    );
  const verification: VerificationSteps = {
    install: "skipped",
    test: "skipped",
    typecheck: "skipped",
    build: "skipped",
  };

  progressStep(`installing with ${plan.manager}, lifecycle scripts suppressed`);
  const install = deps.exec(command, plan.root, replay?.env);
  verification.install = install.code === 0 ? "pass" : "fail";
  if (install.code !== 0) {
    restoreProject(snapshot, deps);
    return receipt(plan, deps, {
      result: "rolled_back",
      reason: "the install failed with scripts suppressed",
      approvals: approved,
      verification,
    });
  }

  if (options.verify !== false) {
    const scripts = projectScripts(deps, plan.root);
    for (const step of VERIFY_STEPS) {
      if (!scripts[step]) continue;
      progressStep(`running ${plan.manager} run ${step}`);
      const result = deps.exec([plan.manager, "run", step], plan.root);
      verification[step] = result.code === 0 ? "pass" : "fail";
      if (result.code !== 0) {
        restoreProject(snapshot, deps);
        return receipt(plan, deps, {
          result: "rolled_back",
          reason: `project verification failed at ${step}`,
          approvals: approved,
          verification,
        });
      }
    }
  }

  const observed = deps.currentGraphDigest?.(plan.root);
  if (observed && observed !== plan.graph_after) {
    restoreProject(snapshot, deps);
    return receipt(plan, deps, {
      result: "rolled_back",
      reason: `the installed graph is ${observed} but the plan reviewed ${plan.graph_after}; re-plan and review the difference`,
      approvals: approved,
      verification,
      ...(observed ? { observedGraph: observed } : {}),
    });
  }

  return receipt(plan, deps, {
    result: "applied",
    approvals: approved,
    verification,
    ...(observed ? { observedGraph: observed } : {}),
  });
}
