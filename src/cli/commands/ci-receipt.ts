import type { TransactionReceipt } from "../../graph/receipt.ts";
import type { CiFinding } from "../../schema.ts";
import { SCHEMA_VERSION } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { readReceipt, verifyReceipt } from "./verify.ts";

export function exceptionFindings(
  receipt: TransactionReceipt,
  file: string,
  allowed: string[],
): CiFinding[] {
  return (receipt.exceptions ?? [])
    .filter((exception) => !allowed.includes(exception.kind))
    .map((exception) => ({
      schema_version: SCHEMA_VERSION,
      rule: "transaction-exception",
      package: "",
      file,
      level: "block" as const,
      evidence: `the receipt was issued with ${exception.flag}: ${exception.detail}`,
      fix: `re-run the transaction without ${exception.flag}, or allow "${exception.kind}" under ci.allowExceptions in warden.config.json`,
      verify: "warden verify",
      seen_before: false,
    }));
}

export function receiptFindings(
  root: string,
  deps: WardenDeps,
  graphFiles: string[],
  allowedExceptions: string[],
): CiFinding[] {
  const level = "block" as const;
  const file = graphFiles[0] as string;
  const receipt = readReceipt(deps, root);
  if (!receipt) {
    return [
      {
        schema_version: SCHEMA_VERSION,
        rule: "transaction-receipt",
        package: "",
        file,
        level,
        evidence: "the dependency graph changed but no warden transaction receipt was committed",
        fix: "run warden plan and warden apply so the change carries a receipt",
        verify: "warden verify",
        seen_before: false,
      },
    ];
  }
  const exceptions = exceptionFindings(receipt, file, allowedExceptions);
  const report = verifyReceipt(receipt, deps);
  if (report.verified) return exceptions;
  return [
    ...exceptions,
    ...report.checks
      .filter((check) => !check.ok)
      .map((check) => ({
        schema_version: SCHEMA_VERSION,
        rule: "transaction-receipt",
        package: "",
        file,
        level,
        evidence: `${check.name}: ${check.detail}`,
        fix: "re-run warden plan and warden apply against the current graph",
        verify: "warden verify",
        seen_before: false,
      })),
  ];
}
