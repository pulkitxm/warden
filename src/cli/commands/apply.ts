import { join } from "node:path";
import { applyTransaction } from "../../graph/apply.ts";
import {
  approvalPath,
  collectApprovals,
  hashScript,
  recordApproval,
} from "../../graph/approvals.ts";
import { digestGraph, type GraphChange } from "../../graph/delta.ts";
import { installedIdentities, readInstalledGraph } from "../../graph/installed.ts";
import type { TransactionPlan } from "../../graph/plan.ts";
import type { TransactionReceipt } from "../../graph/receipt.ts";
import { fetchPackument } from "../../registry.ts";
import { ANALYZER_VERSION, EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { PLAN_DIR } from "./plan.ts";

export const RECEIPT_DIR = join(".warden", "receipts");
export const LAST_RECEIPT = join(".warden", "last-receipt.json");

export function readPlan(deps: WardenDeps, root: string, id: string): TransactionPlan | null {
  const path = join(root, PLAN_DIR, `${id}.json`);
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readFile(path)) as TransactionPlan;
  } catch {
    return null;
  }
}

export async function scriptBodyFromRegistry(change: GraphChange, hook: string): Promise<string> {
  const packument = await fetchPackument(change.name);
  return packument?.versions?.[change.version]?.scripts?.[hook] ?? "";
}

export function renderReceipt(receipt: TransactionReceipt): string {
  const label =
    receipt.result === "applied"
      ? c("32", "APPLIED")
      : receipt.result === "rolled_back"
        ? c("31", "ROLLED BACK")
        : c("33", "REFUSED");
  const lines: string[] = ["", bold(`Warden apply: ${receipt.command}`), ""];
  lines.push(`  ${label}  ${receipt.transaction_id}`);
  if (receipt.reason) lines.push(`  ${receipt.reason}`);
  lines.push("");
  lines.push(bold("  Verification"));
  for (const [step, state] of Object.entries(receipt.verification))
    lines.push(`    ${step.padEnd(10)} ${state}`);
  lines.push("");
  lines.push(
    dim(
      `  ${receipt.approvals.length} approved scripts, ${receipt.suppressed_scripts.length} packages with scripts suppressed`,
    ),
  );
  if (receipt.result === "applied")
    lines.push(dim(`  receipt written to ${join(RECEIPT_DIR, `${receipt.transaction_id}.json`)}`));
  lines.push("");
  return lines.join("\n");
}

export function requiresRepoScopedApprovals(deps: WardenDeps, root: string): boolean {
  const path = join(root, "warden.config.json");
  if (!deps.exists(path)) return false;
  try {
    const config = JSON.parse(deps.readFile(path)) as {
      approvals?: { requireRepoScope?: boolean };
    };
    return config.approvals?.requireRepoScope === true;
  } catch {
    return false;
  }
}

export async function runWardenApply(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const id = argv.find((arg) => !arg.startsWith("-"));

  if (!id) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_APPLY_USAGE",
      "no plan id was given",
      "run warden plan first, then warden apply <plan-id>",
    );
  }

  const plan = readPlan(deps, root, id);
  if (!plan) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_APPLY_UNKNOWN_PLAN",
      `no plan ${id} was found in ${PLAN_DIR}`,
      "re-run warden plan to produce a current plan",
    );
  }

  let receipt: TransactionReceipt;
  try {
    receipt = await applyTransaction(
      plan,
      {
        exec: (cmd, cwd, env) => ({ code: deps.spawnIn(cmd, cwd, env) }),
        currentGraphDigest: (root) =>
          digestGraph(
            installedIdentities(
              readInstalledGraph({ exists: deps.exists, readFile: deps.readFile }, root),
            ),
          ),
        readFile: deps.readFile,
        writeFile: deps.writeFile,
        exists: deps.exists,
        scriptBody: scriptBodyFromRegistry,
        approvals: collectApprovals(deps, root, deps.home, requiresRepoScopedApprovals(deps, root)),
        analyzerVersion: ANALYZER_VERSION,
      },
      {
        verify: !argv.includes("--no-verify"),
        skipScriptApproval:
          argv.includes("--skip-script-approval") || argv.includes("--allow-unapproved"),
        allowIncompleteAnalysis: argv.includes("--allow-incomplete-analysis"),
        allowStalePlan: argv.includes("--allow-stale-plan"),
      },
    );
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_APPLY_ERROR",
      `the transaction could not be applied: ${(error as Error).message}`,
      "re-run warden plan and inspect the plan before applying",
    );
  }

  try {
    deps.mkdir(join(root, RECEIPT_DIR));
    const body = `${JSON.stringify(receipt, null, 2)}\n`;
    deps.writeFile(join(root, RECEIPT_DIR, `${receipt.transaction_id}.json`), body);
    deps.writeFile(join(root, LAST_RECEIPT), body);
  } catch {
    receipt.reason = `${receipt.reason ?? ""} the receipt could not be written`.trim();
  }

  if (wantsJson) deps.stdout(`${JSON.stringify(receipt)}\n`);
  else if (!isQuiet()) deps.stderr(renderReceipt(receipt));

  if (receipt.result === "applied") return EXIT.allow;
  return receipt.result === "refused" ? EXIT.block : EXIT.error;
}

export async function runWardenApproveScript(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const flagValue = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const spec = positional[0];
  const hook = flagValue("--hook");
  if (!spec?.includes("@") || !hook) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_APPROVE_USAGE",
      "an exact package@version and a --hook are both required",
      "warden approve-script esbuild@0.25.8 --hook postinstall",
    );
  }

  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const scope = flagValue("--scope") === "user" ? "user" : "repo";

  let script = "";
  let integrity = flagValue("--integrity") ?? "";
  try {
    const packument = await fetchPackument(name);
    const meta = packument?.versions?.[version];
    if (!meta) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_APPROVE_UNKNOWN",
        `${name}@${version} was not found on the registry`,
        "approve an exact published version",
      );
    }
    script = meta.scripts?.[hook] ?? "";
    if (!script) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_APPROVE_NO_SCRIPT",
        `${name}@${version} has no ${hook} script to approve`,
        "check the hook name against warden plan",
      );
    }
    integrity = integrity || (meta.dist?.integrity ?? "");
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_APPROVE_ERROR",
      (error as Error).message,
      "retry once the registry is reachable",
    );
  }

  const approval = {
    schema_version: 1 as const,
    package: name,
    version,
    integrity,
    hook,
    script_hash: hashScript(script),
    scope: scope as "repo" | "user",
    approved_at: new Date().toISOString(),
    ...(flagValue("--note") ? { note: flagValue("--note") as string } : {}),
  };

  try {
    recordApproval(deps, approvalPath(scope, root, deps.home), approval);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "config",
      "WARDEN_APPROVE_WRITE",
      `the approval could not be written: ${(error as Error).message}`,
      "check that the .warden directory is writable",
    );
  }

  if (wantsJson) deps.stdout(`${JSON.stringify(approval)}\n`);
  else if (!isQuiet())
    deps.stderr(
      `\napproved ${name}@${version} ${hook} for the ${scope} scope\n  script ${approval.script_hash}\n  integrity ${integrity || "unknown"}\n\n${dim("this approval is void if the version, integrity, or script body changes")}\n\n`,
    );
  return EXIT.allow;
}
