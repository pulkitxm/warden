export interface McpCommand {
  name: string;
  description: string;
  hidden?: boolean;
  positional?: { kind: string; values?: readonly string[] } | undefined;
  flags: ReadonlyArray<{ name: string; description: string; valueHint?: string }>;
  exitCodes: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: readonly string[] }>;
    required: string[];
    additionalProperties: false;
  };
  exitCodes: string;
}

const EXPOSED = new Set([
  "plan",
  "explain",
  "compare",
  "history",
  "check",
  "coverage",
  "policy",
  "scripts",
  "verify",
  "detect",
  "ci",
]);

const MUTATING = new Set([
  "apply",
  "approve-script",
  "init",
  "config",
  "uninstall",
  "doctor",
  "fix",
]);

function toolName(command: string): string {
  return `warden_${command.replace(/-/g, "_")}`;
}

export function toolFor(command: McpCommand): McpTool {
  const properties: McpTool["inputSchema"]["properties"] = {};
  const required: string[] = [];

  if (command.positional) {
    properties.args = {
      type: "array",
      description: `positional arguments: ${command.positional.kind}${
        command.positional.values ? ` (one of ${command.positional.values.join(", ")})` : ""
      }`,
    };
    if (!command.positional.kind.startsWith("[")) required.push("args");
  }

  for (const flag of command.flags) {
    if (flag.name === "--help" || flag.name === "--json") continue;
    properties[flag.name.replace(/^--/, "").replace(/-/g, "_")] = {
      type: flag.valueHint ? "string" : "boolean",
      description: flag.description,
    };
  }

  return {
    name: toolName(command.name),
    description: `${command.description}. Returns the published JSON report on stdout.`,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    exitCodes: command.exitCodes,
  };
}

export function buildMcpTools(registry: readonly McpCommand[]): McpTool[] {
  return registry
    .filter((command) => !command.hidden && EXPOSED.has(command.name))
    .map(toolFor)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function excludedFromMcp(registry: readonly McpCommand[]): string[] {
  return registry
    .filter((command) => !command.hidden && MUTATING.has(command.name))
    .map((command) => command.name)
    .sort();
}

export interface McpManifest {
  schema_version: 1;
  name: string;
  version: string;
  description: string;
  tools: McpTool[];
  read_only: true;
  excluded: Array<{ command: string; reason: string }>;
}

export function buildManifest(registry: readonly McpCommand[], version: string): McpManifest {
  return {
    schema_version: 1,
    name: "warden",
    version,
    description:
      "Plan, explain, and compare dependency changes. Every tool is generated from the same command registry the CLI uses, so the two cannot drift.",
    tools: buildMcpTools(registry),
    read_only: true,
    excluded: excludedFromMcp(registry).map((command) => ({
      command,
      reason:
        "changes the project or the trust configuration; a human runs this, not a model through a tool call",
    })),
  };
}

export function argvFor(tool: string, input: Record<string, unknown>): string[] {
  const command = tool.replace(/^warden_/, "").replace(/_/g, "-");
  const argv: string[] = [command];
  const args = input.args;
  if (Array.isArray(args)) argv.push(...args.map(String));
  else if (typeof args === "string") argv.push(args);

  for (const [key, value] of Object.entries(input)) {
    if (key === "args" || value === undefined || value === false) continue;
    const flag = `--${key.replace(/_/g, "-")}`;
    if (value === true) argv.push(flag);
    else argv.push(flag, String(value));
  }
  argv.push("--json");
  return argv;
}
