export type AgentCapability =
  | "instruction-file"
  | "skill"
  | "pre-command-hook"
  | "post-change-hook"
  | "mcp"
  | "managed-settings";

export interface AgentAdapter {
  name: string;
  launch: string;
  capabilities: AgentCapability[];
  instructionFile?: string;
  skillPath?: string;
  hookConfig?: string;
  mcpConfig?: string;
  reference: string;
}

export const ADAPTERS: AgentAdapter[] = [
  {
    name: "claude",
    launch: "claude -p",
    capabilities: [
      "instruction-file",
      "skill",
      "pre-command-hook",
      "post-change-hook",
      "mcp",
      "managed-settings",
    ],
    instructionFile: "CLAUDE.md",
    skillPath: ".claude/skills/warden/SKILL.md",
    hookConfig: ".claude/settings.json",
    mcpConfig: ".mcp.json",
    reference: "https://code.claude.com/docs/en/hooks-guide",
  },
  {
    name: "codex",
    launch: "codex exec",
    capabilities: ["instruction-file", "skill", "pre-command-hook", "mcp", "managed-settings"],
    instructionFile: "AGENTS.md",
    skillPath: ".agents/skills/warden/SKILL.md",
    hookConfig: ".codex/hooks.json",
    mcpConfig: ".codex/config.toml",
    reference: "https://developers.openai.com/codex/hooks",
  },
  {
    name: "cursor",
    launch: "cursor-agent -p",
    capabilities: ["instruction-file", "mcp"],
    instructionFile: "AGENTS.md",
    mcpConfig: ".cursor/mcp.json",
    reference: "https://docs.cursor.com",
  },
  {
    name: "copilot",
    launch: "copilot -p",
    capabilities: ["instruction-file"],
    instructionFile: ".github/copilot-instructions.md",
    reference: "https://docs.github.com/copilot",
  },
  {
    name: "gemini",
    launch: "gemini -p",
    capabilities: ["instruction-file", "mcp"],
    instructionFile: "GEMINI.md",
    mcpConfig: ".gemini/settings.json",
    reference: "https://github.com/google-gemini/gemini-cli",
  },
  {
    name: "aider",
    launch: "aider --message",
    capabilities: ["instruction-file"],
    instructionFile: "CONVENTIONS.md",
    reference: "https://aider.chat/docs",
  },
  {
    name: "opencode",
    launch: "opencode run",
    capabilities: ["instruction-file", "mcp"],
    instructionFile: "AGENTS.md",
    mcpConfig: "opencode.json",
    reference: "https://opencode.ai/docs",
  },
];

export const CAPABILITY_FALLBACK: Record<AgentCapability, string> = {
  "instruction-file": "guidance only; an agent can ignore it",
  skill: "guidance only; an agent can ignore it",
  "pre-command-hook": "the PATH shim mediates the command instead",
  "post-change-hook": "warden ci verifies the receipt instead",
  mcp: "the agent calls the CLI and parses its JSON instead",
  "managed-settings": "policy lives in warden.config.json and is enforced in CI",
};

export function adapterFor(name: string): AgentAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.name === name);
}

export function supports(adapter: AgentAdapter, capability: AgentCapability): boolean {
  return adapter.capabilities.includes(capability);
}

export function enforcementLayers(adapter: AgentAdapter): string[] {
  const layers: string[] = [];
  if (supports(adapter, "instruction-file") || supports(adapter, "skill"))
    layers.push("guidance: the agent is told to plan a dependency change before running it");
  if (supports(adapter, "pre-command-hook"))
    layers.push("interception: a package-manager command is mediated before it executes");
  else layers.push(`interception: ${CAPABILITY_FALLBACK["pre-command-hook"]}`);
  if (supports(adapter, "post-change-hook"))
    layers.push("verification: the receipt is checked after the agent stops");
  else layers.push(`verification: ${CAPABILITY_FALLBACK["post-change-hook"]}`);
  layers.push("backstop: warden ci --require-transaction-receipt, which no agent can skip");
  return layers;
}

export const SKILL_BODY = `---
name: warden
description: Plan, approve, and verify dependency changes before anything installs.
---

# Warden

Never run a package manager install directly. A dependency change is a transaction.

1. Plan it: \`warden plan --json -- <the command you were about to run>\`.
2. Read the decision. \`ALLOW\` means proceed. \`BLOCK\` means do not install; run \`warden explain <package>@<version>\` and \`warden compare <package> <alternative>\` to find something established instead.
3. \`NEEDS_APPROVAL\` means the change introduces install scripts or the analysis was incomplete. Report exactly which package and hook to the human and ask for \`warden approve-script <pkg>@<version> --hook <hook>\`. Do not approve on the human's behalf.
4. Apply it: \`warden apply <plan-id>\`. This installs with lifecycle scripts suppressed and runs the project's own tests.
5. If a check fails, \`warden handoff\` produces a bundle carrying both a fix and the command that verifies it.

Exit codes are the contract: 0 allow, 10 warn or needs approval, 20 block, 30 analysis error. Parse the JSON, not the human text.
`;

export function instructionSection(version: string): string {
  return `
## Warden

<!-- warden-adapter-version: ${version} -->

Dependency changes go through Warden, not directly through a package manager.

- Plan first: \`warden plan --json -- npm install <package>\`
- Read the decision and exit code: 0 allow, 10 warn or needs approval, 20 block, 30 error
- Apply a plan: \`warden apply <plan-id>\`
- Explain a block: \`warden explain <package>@<version>\`
- Never pass \`--skip-script-approval\` or approve an install script without asking the human first
`;
}
