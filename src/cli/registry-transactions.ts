import { runWardenAgent } from "./commands/agent.ts";
import { runWardenApply, runWardenApproveScript } from "./commands/apply.ts";
import { runWardenBaseline } from "./commands/baseline.ts";
import { runWardenCompare, runWardenScripts } from "./commands/compare.ts";
import { runWardenExplain, runWardenHistory } from "./commands/explain.ts";
import { runWardenPlan } from "./commands/plan.ts";
import { runWardenPolicy } from "./commands/policy.ts";
import { runWardenShimTransaction } from "./commands/shim-transaction.ts";
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
  {
    name: "policy",
    description: "compile the repository policy into each package manager's own settings",
    flags: [
      {
        name: "--manager",
        valueHint: "<npm|pnpm|yarn|bun>",
        description: "compile for one manager",
      },
      { name: "--json", description: "write the compiled policy to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden policy --manager pnpm",
    run: runWardenPolicy,
  },
  {
    name: "explain",
    description: "explain one verdict: what changed, why it matters, and what to do next",
    positional: { kind: "<pkg[@version]>" },
    flags: [{ name: "--json", description: "write the explanation to stdout" }, helpFlag],
    exitCodes: "0 allow · 10 warn · 20 block · 30 error",
    example: "warden explain left-pad@1.3.0",
    run: runWardenExplain,
  },
  {
    name: "history",
    description: "show how a package's releases changed publisher, provenance, and scripts",
    positional: { kind: "<pkg>" },
    flags: [
      { name: "--tail", valueHint: "N", description: "show only the last N releases" },
      { name: "--json", description: "write the release history to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden history left-pad --tail 5",
    run: runWardenHistory,
  },
  {
    name: "compare",
    description: "compare candidate packages on evidence rather than on preference",
    positional: { kind: "<pkg> <pkg> [pkg...]" },
    flags: [{ name: "--json", description: "write the comparison to stdout" }, helpFlag],
    exitCodes: "0 success · 30 error",
    example: "warden compare jscodeshift react-codemod",
    run: runWardenCompare,
  },
  {
    name: "scripts",
    description: "list install scripts in the current graph and which still need approval",
    positional: { kind: "[pending]", values: ["pending"] },
    flags: [{ name: "--json", description: "write the script inventory to stdout" }, helpFlag],
    exitCodes: "0 all approved · 10 approvals pending · 30 error",
    example: "warden scripts pending",
    run: runWardenScripts,
  },
  {
    name: "agent",
    learnMore: "agents",
    description: "set up and check the coding-agent adapters, and print the MCP tool manifest",
    positional: { kind: "[doctor|setup|mcp] [name]" },
    flags: [
      { name: "--all", description: "set up every known agent adapter" },
      { name: "--yes", description: "write the adapter files instead of only planning them" },
      { name: "--json", description: "write the adapter report to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden agent setup claude --yes",
    run: runWardenAgent,
  },
  {
    name: "baseline",
    description: "show and record the trusted version a release should be compared against",
    positional: { kind: "[list|record] [pkg@version]", values: ["list", "record"] },
    flags: [
      { name: "--note", valueHint: "<text>", description: "why this version is trusted" },
      { name: "--json", description: "write the baselines to stdout" },
      helpFlag,
    ],
    exitCodes: "0 success · 30 error",
    example: "warden baseline record left-pad@1.3.0",
    run: runWardenBaseline,
  },
  {
    name: "shim-transaction",
    description: "gate an intercepted install on the whole prospective graph",
    hidden: true,
    flags: [],
    exitCodes: "0 success",
    example: "warden shim-transaction npm install left-pad",
    run: runWardenShimTransaction,
  },
];
