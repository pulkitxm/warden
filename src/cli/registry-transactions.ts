import { runWardenApply, runWardenApproveScript } from "./commands/apply.ts";
import { runWardenPlan } from "./commands/plan.ts";
import { runWardenVerify } from "./commands/verify.ts";
import { type CommandDefinition, helpFlag } from "./help.ts";

export const TRANSACTION_COMMANDS: readonly CommandDefinition[] = [
  {
    name: "plan",
    description: "resolve the prospective dependency graph and decide before anything installs",
    positional: { kind: "[-- <manager> <command>|<pkg>...]" },
    flags: [{ name: "--json", description: "write the transaction plan to stdout" }, helpFlag],
    exitCodes: "0 allow · 10 warn or needs approval · 20 block · 30 error",
    example: "warden plan -- npm install @fastify/jwt",
    run: runWardenPlan,
  },
  {
    name: "apply",
    description: "install a planned transaction with scripts suppressed, then verify it",
    positional: { kind: "<plan-id>" },
    flags: [
      { name: "--no-verify", description: "skip the project verification steps" },
      { name: "--allow-unapproved", description: "install even when scripts are unapproved" },
      { name: "--json", description: "write the transaction receipt to stdout" },
      helpFlag,
    ],
    exitCodes: "0 applied · 20 refused · 30 rolled back or error",
    example: "warden apply wtxn_0a1b2c3d",
    run: runWardenApply,
  },
  {
    name: "approve-script",
    description: "approve one lifecycle script, bound to its version, integrity, and body",
    positional: { kind: "<pkg@version>" },
    flags: [
      { name: "--hook", valueHint: "<name>", description: "the lifecycle hook being approved" },
      { name: "--scope", valueHint: "<repo|user>", description: "where the approval is recorded" },
      { name: "--integrity", valueHint: "<sha512-...>", description: "pin a specific tarball" },
      { name: "--note", valueHint: "<text>", description: "why this script was approved" },
      { name: "--json", description: "write the approval record to stdout" },
      helpFlag,
    ],
    exitCodes: "0 approved · 30 error",
    example: "warden approve-script esbuild@0.25.8 --hook postinstall",
    run: runWardenApproveScript,
  },
  {
    name: "verify",
    description: "check that the installed graph is the one a receipt was issued for",
    positional: { kind: "[transaction-id]" },
    flags: [{ name: "--json", description: "write the verification report to stdout" }, helpFlag],
    exitCodes: "0 verified · 20 mismatch · 30 no receipt",
    example: "warden verify",
    run: runWardenVerify,
  },
];
