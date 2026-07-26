import { join } from "node:path";
import { digestGraph } from "../../graph/delta.ts";
import { installedIdentities, readInstalledGraph } from "../../graph/installed.ts";
import type { TransactionPlan } from "../../graph/plan.ts";
import type { TransactionReceipt } from "../../graph/receipt.ts";
import { policyDigest } from "../../graph/receipt.ts";
import { EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { LAST_RECEIPT, RECEIPT_DIR, readPlan } from "./apply.ts";

export interface VerifyReport {
  schema_version: 1;
  transaction_id: string;
  plan_id: string;
  installed_digest: string;
  receipt_digest: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  verified: boolean;
}

export function readReceipt(
  deps: WardenDeps,
  root: string,
  id?: string,
): TransactionReceipt | null {
  const path = id ? join(root, RECEIPT_DIR, `${id}.json`) : join(root, LAST_RECEIPT);
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readFile(path)) as TransactionReceipt;
  } catch {
    return null;
  }
}

export function verifyReceipt(receipt: TransactionReceipt, deps: WardenDeps): VerifyReport {
  const root = deps.cwd();
  const installed = readInstalledGraph({ exists: deps.exists, readFile: deps.readFile }, root);
  const installedDigest = digestGraph(installedIdentities(installed));

  const checks: VerifyReport["checks"] = [];
  checks.push({
    name: "graph matches receipt",
    ok: installedDigest === receipt.graph_after,
    detail:
      installedDigest === receipt.graph_after
        ? "the installed graph is the one the receipt was issued for"
        : `installed ${installedDigest} but the receipt records ${receipt.graph_after}`,
  });

  const plan = readPlan(deps, root, receipt.plan_id);
  checks.push({
    name: "policy digest",
    ok: Boolean(plan) && policyDigest(plan as TransactionPlan) === receipt.policy_digest,
    detail: plan
      ? policyDigest(plan) === receipt.policy_digest
        ? "the receipt was issued under the plan still on disk"
        : "the plan on disk no longer matches the policy the receipt records"
      : `plan ${receipt.plan_id} is not on disk, so the policy behind this receipt cannot be confirmed`,
  });

  checks.push({
    name: "result",
    ok: receipt.result === "applied",
    detail: `the transaction was ${receipt.result.replace(/_/g, " ")}`,
  });

  const failedSteps = Object.entries(receipt.verification).filter(([, state]) => state === "fail");
  checks.push({
    name: "project verification",
    ok: !failedSteps.length,
    detail: failedSteps.length
      ? `failed at ${failedSteps.map(([step]) => step).join(", ")}`
      : "no verification step failed",
  });

  const unresolved = receipt.artifacts.filter(
    (artifact) => artifact.verdict === "unchecked" || artifact.verdict === "unanalyzable",
  );
  checks.push({
    name: "artifact coverage",
    ok: !unresolved.length,
    detail: unresolved.length
      ? `${unresolved.length} artifacts were never analyzed`
      : `${receipt.artifacts.length} artifacts carry a verdict`,
  });

  return {
    schema_version: 1,
    transaction_id: receipt.transaction_id,
    plan_id: receipt.plan_id,
    installed_digest: installedDigest,
    receipt_digest: receipt.graph_after,
    checks,
    verified: checks.every((check) => check.ok),
  };
}

export function renderVerify(report: VerifyReport): string {
  const lines = ["", bold(`WARDEN VERIFY  ${report.transaction_id}`), ""];
  for (const check of report.checks) {
    lines.push(
      `  ${check.ok ? c("32", "ok  ") : c("31", "fail")}  ${check.name.padEnd(22)} ${check.detail}`,
    );
  }
  lines.push("");
  lines.push(dim(`  plan ${report.plan_id}`));
  lines.push("");
  return lines.join("\n");
}

export function runWardenVerify(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const id = argv.find((arg) => !arg.startsWith("-"));
  const receipt = readReceipt(deps, root, id);

  if (!receipt) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_VERIFY_NO_RECEIPT",
      id ? `no receipt ${id} was found in ${RECEIPT_DIR}` : "no transaction receipt was found",
      "run warden apply to produce a receipt",
    );
  }

  const report = verifyReceipt(receipt, deps);
  if (wantsJson) deps.stdout(`${JSON.stringify(report)}\n`);
  else if (!isQuiet()) deps.stderr(renderVerify(report));
  return report.verified ? EXIT.allow : EXIT.block;
}
