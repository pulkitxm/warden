export const AGENT_ADAPTERS: Record<string, string> = {
  claude: "claude -p",
  cursor: "cursor-agent -p",
  codex: "codex exec",
  copilot: "copilot -p",
  gemini: "gemini -p",
  aider: "aider --message",
  opencode: "opencode run",
};

export const AGENT_NAMES = Object.keys(AGENT_ADAPTERS);

export const DEFAULT_AGENT = "claude";
