import { createHash } from "node:crypto";
import type { ScriptApproval } from "./approvals.ts";
import type { PlanArtifact, TransactionPlan } from "./plan.ts";

export type ReceiptResult = "applied" | "rolled_back" | "refused";

export interface VerificationSteps {
  install: "pass" | "fail" | "skipped";
  test: "pass" | "fail" | "skipped";
  typecheck: "pass" | "fail" | "skipped";
  build: "pass" | "fail" | "skipped";
}

export interface TransactionReceipt {
  schema_version: 1;
  transaction_id: string;
  plan_id: string;
  command: string;
  manager: { name: string; version?: string };
  graph_before: string;
  graph_after: string;
  observed_graph?: string;
  request_digest?: string;
  policy_digest: string;
  artifacts: PlanArtifact[];
  approvals: ScriptApproval[];
  suppressed_scripts: Array<{ package: string; version: string; hooks: string[] }>;
  verification: VerificationSteps;
  result: ReceiptResult;
  reason?: string;
  analyzer_version: string;
}

export function policyDigest(plan: TransactionPlan): string {
  const canonical = JSON.stringify({
    manager: plan.manager,
    direct: plan.direct,
    request: plan.request
      ? {
          operation: plan.request.operation,
          argv: plan.request.argv,
          workspace: plan.request.workspace ?? null,
          dependencyClass: plan.request.dependencyClass ?? "prod",
        }
      : null,
    graph_before: plan.graph_before,
    graph_after: plan.graph_after,
    coverage: plan.coverage,
    truncated: plan.truncated,
    artifacts: plan.artifacts.map((artifact) => ({
      package: artifact.package,
      version: artifact.version,
      integrity: artifact.integrity ?? null,
      verdict: artifact.verdict,
    })),
    decision: plan.decision,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function transactionId(planId: string, graphAfter: string): string {
  const digest = createHash("sha256").update(`${planId}\n${graphAfter}`).digest("hex");
  return `wtxn_${digest.slice(0, 24)}`;
}
