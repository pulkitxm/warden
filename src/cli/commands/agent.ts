import { join } from "node:path";
import {
  ADAPTERS,
  type AgentAdapter,
  adapterFor,
  CAPABILITY_FALLBACK,
  enforcementLayers,
  instructionSection,
  SKILL_BODY,
  supports,
} from "../../agent/capabilities.ts";
import { buildManifest } from "../../agent/mcp.ts";
import { ANALYZER_VERSION, EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { COMMAND_REGISTRY } from "../registry.ts";

export interface AgentChange {
  file: string;
  capability: string;
  action: "create" | "append" | "skip";
  reason: string;
}

export interface AgentSetupPlan {
  schema_version: 1;
  agent: string;
  detected: boolean;
  adapter_version: string;
  changes: AgentChange[];
  enforcement: string[];
  unsupported: Array<{ capability: string; fallback: string }>;
}

const MARKER = "warden-adapter-version";

function planFor(adapter: AgentAdapter, deps: WardenDeps, root: string): AgentSetupPlan {
  const changes: AgentChange[] = [];

  if (adapter.instructionFile) {
    const path = join(root, adapter.instructionFile);
    const existing = deps.exists(path);
    let already = false;
    if (existing) {
      try {
        already = deps.readFile(path).includes(MARKER);
      } catch {
        already = false;
      }
    }
    changes.push({
      file: adapter.instructionFile,
      capability: "instruction-file",
      action: already ? "skip" : existing ? "append" : "create",
      reason: already
        ? "the warden section is already present and carries a version marker"
        : "teach the agent to plan a dependency change before running it",
    });
  }

  if (adapter.skillPath) {
    const already = deps.exists(join(root, adapter.skillPath));
    changes.push({
      file: adapter.skillPath,
      capability: "skill",
      action: already ? "skip" : "create",
      reason: already
        ? "the skill is already installed"
        : "a reusable skill describing the plan, approve, apply loop",
    });
  }

  if (adapter.mcpConfig) {
    changes.push({
      file: adapter.mcpConfig,
      capability: "mcp",
      action: "skip",
      reason: "run warden agent mcp --json and merge the server entry into this file yourself",
    });
  }

  if (adapter.hookConfig) {
    changes.push({
      file: adapter.hookConfig,
      capability: "pre-command-hook",
      action: "skip",
      reason:
        "hook configuration is merged by hand so warden never rewrites settings it does not own",
    });
  }

  const unsupported = (
    [
      "instruction-file",
      "skill",
      "pre-command-hook",
      "post-change-hook",
      "mcp",
      "managed-settings",
    ] as const
  )
    .filter((capability) => !supports(adapter, capability))
    .map((capability) => ({ capability, fallback: CAPABILITY_FALLBACK[capability] }));

  return {
    schema_version: 1,
    agent: adapter.name,
    detected: Boolean(deps.which(adapter.launch.split(" ")[0] as string)),
    adapter_version: ANALYZER_VERSION,
    changes,
    enforcement: enforcementLayers(adapter),
    unsupported,
  };
}

function applyPlan(plan: AgentSetupPlan, adapter: AgentAdapter, deps: WardenDeps, root: string) {
  for (const change of plan.changes) {
    if (change.action === "skip") continue;
    const path = join(root, change.file);
    if (change.capability === "instruction-file") {
      const existing = change.action === "append" ? deps.readFile(path).trimEnd() : "";
      deps.writeFile(path, `${existing}${instructionSection(ANALYZER_VERSION)}`);
      continue;
    }
    if (change.capability === "skill") {
      deps.mkdir(join(root, change.file.slice(0, change.file.lastIndexOf("/"))));
      deps.writeFile(path, SKILL_BODY);
    }
  }
  void adapter;
}

export function renderSetup(plan: AgentSetupPlan, applied: boolean): string {
  const lines = ["", bold(`Warden adapter for ${plan.agent}`), ""];
  lines.push(
    `  ${plan.detected ? c("32", "detected") : dim("not found")}  adapter ${plan.adapter_version}`,
  );
  lines.push("");
  lines.push(bold("  Files"));
  for (const change of plan.changes) {
    const label =
      change.action === "skip"
        ? dim("skip  ")
        : applied
          ? c("32", `${change.action}d`.padEnd(6))
          : c("33", `${change.action}`.padEnd(6));
    lines.push(`    ${label} ${change.file}`);
    lines.push(`           ${dim(change.reason)}`);
  }
  lines.push("");
  lines.push(bold("  Enforcement layers"));
  for (const layer of plan.enforcement) lines.push(`    ${layer}`);
  if (plan.unsupported.length) {
    lines.push("");
    lines.push(bold("  Not supported by this agent"));
    for (const entry of plan.unsupported)
      lines.push(`    ${entry.capability.padEnd(20)} ${dim(entry.fallback)}`);
  }
  lines.push("");
  if (!applied) lines.push(dim("  nothing was written; re-run with --yes to apply"));
  lines.push("");
  return lines.join("\n");
}

export function renderDoctor(plans: AgentSetupPlan[]): string {
  const lines = ["", bold("Warden agent integration"), ""];
  for (const plan of plans) {
    const pending = plan.changes.filter((change) => change.action !== "skip").length;
    const status = !plan.detected
      ? dim("absent  ")
      : pending
        ? c("33", "partial ")
        : c("32", "ready   ");
    lines.push(
      `  ${status} ${plan.agent.padEnd(10)} ${plan.enforcement.length} enforcement layers`,
    );
    if (plan.detected && pending)
      lines.push(dim(`           warden agent setup ${plan.agent} --yes`));
  }
  lines.push("");
  lines.push(
    dim("  an agent with no hook support is still covered by the shim and by the CI receipt gate"),
  );
  lines.push("");
  return lines.join("\n");
}

export function runWardenAgent(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const verb = positional[0] ?? "doctor";
  const root = deps.cwd();

  if (verb === "mcp") {
    const manifest = buildManifest(COMMAND_REGISTRY, ANALYZER_VERSION);
    if (wantsJson) {
      deps.stdout(`${JSON.stringify(manifest, null, 2)}\n`);
      return EXIT.allow;
    }
    if (isQuiet()) return EXIT.allow;
    const lines = ["", bold("Warden MCP tools"), ""];
    for (const tool of manifest.tools) {
      lines.push(`  ${tool.name.padEnd(20)} ${tool.description.split(".")[0]}`);
      lines.push(`    ${dim(`exit codes: ${tool.exitCodes}`)}`);
    }
    lines.push("");
    lines.push(bold("  Deliberately not exposed"));
    for (const entry of manifest.excluded)
      lines.push(`    ${entry.command.padEnd(20)} ${dim(entry.reason)}`);
    lines.push("");
    lines.push(
      dim(
        "  every tool is generated from the same command registry the CLI uses, so the two cannot drift",
      ),
    );
    lines.push("");
    deps.stderr(lines.join("\n"));
    return EXIT.allow;
  }

  if (verb === "doctor") {
    const plans = ADAPTERS.map((adapter) => planFor(adapter, deps, root));
    if (wantsJson) {
      deps.stdout(`${JSON.stringify({ schema_version: 1, agents: plans })}\n`);
      return EXIT.allow;
    }
    if (!isQuiet()) deps.stderr(renderDoctor(plans));
    return EXIT.allow;
  }

  if (verb !== "setup") {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_AGENT_USAGE",
      `unknown agent command "${verb}"`,
      "run warden agent doctor, warden agent setup <name>, or warden agent mcp",
    );
  }

  const target = positional[1];
  const all = argv.includes("--all");
  if (!target && !all) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_AGENT_TARGET",
      "no agent was named",
      `warden agent setup <${ADAPTERS.map((adapter) => adapter.name).join("|")}> or --all`,
    );
  }

  const targets = all ? ADAPTERS : [adapterFor(target as string)].filter(Boolean as never);
  if (!targets.length) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_AGENT_UNKNOWN",
      `unknown agent "${target}"`,
      `known agents: ${ADAPTERS.map((adapter) => adapter.name).join(", ")}`,
    );
  }

  const apply = argv.includes("--yes");
  const plans: AgentSetupPlan[] = [];
  for (const adapter of targets as AgentAdapter[]) {
    const plan = planFor(adapter, deps, root);
    if (apply) {
      try {
        applyPlan(plan, adapter, deps, root);
      } catch (error) {
        return wardenFailure(
          deps,
          wantsJson,
          "config",
          "WARDEN_AGENT_WRITE",
          `the adapter for ${adapter.name} could not be written: ${(error as Error).message}`,
          "check that the repository is writable",
        );
      }
    }
    plans.push(plan);
  }

  if (wantsJson) {
    deps.stdout(`${JSON.stringify({ schema_version: 1, applied: apply, agents: plans })}\n`);
    return EXIT.allow;
  }
  if (!isQuiet()) for (const plan of plans) deps.stderr(renderSetup(plan, apply));
  return EXIT.allow;
}
