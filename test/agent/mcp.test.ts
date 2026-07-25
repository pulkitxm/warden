import { expect, test } from "bun:test";
import {
  argvFor,
  buildManifest,
  buildMcpTools,
  excludedFromMcp,
  toolFor,
} from "../../src/agent/mcp.ts";
import { COMMAND_REGISTRY } from "../../src/cli/registry.ts";

const tools = buildMcpTools(COMMAND_REGISTRY);
const names = tools.map((tool) => tool.name);

test("every exposed tool corresponds to a real command in the registry", () => {
  const commands = new Set(COMMAND_REGISTRY.map((command) => command.name));
  for (const name of names) {
    const command = name.replace(/^warden_/, "").replace(/_/g, "-");
    expect(`${command} in registry: ${commands.has(command)}`).toBe(`${command} in registry: true`);
  }
});

test("planning and explaining are exposed, because that is what an agent needs", () => {
  expect(names).toContain("warden_plan");
  expect(names).toContain("warden_explain");
  expect(names).toContain("warden_compare");
  expect(names).toContain("warden_check");
});

test("nothing that changes the project or the trust configuration is exposed", () => {
  for (const forbidden of [
    "warden_apply",
    "warden_approve_script",
    "warden_init",
    "warden_config",
  ]) {
    expect(names).not.toContain(forbidden);
  }
});

test("the excluded commands are named with a reason rather than silently omitted", () => {
  const manifest = buildManifest(COMMAND_REGISTRY, "0.1.0");
  expect(manifest.excluded.map((entry) => entry.command)).toContain("apply");
  expect(manifest.excluded.map((entry) => entry.command)).toContain("approve-script");
  for (const entry of manifest.excluded) expect(entry.reason.length).toBeGreaterThan(20);
});

test("no hidden command leaks into the tool surface", () => {
  const hidden = COMMAND_REGISTRY.filter((command) => command.hidden).map(
    (command) => command.name,
  );
  for (const name of hidden) {
    expect(names).not.toContain(`warden_${name.replace(/-/g, "_")}`);
  }
});

test("the manifest is read-only, which is the whole reason it is safe to expose", () => {
  expect(buildManifest(COMMAND_REGISTRY, "0.1.0").read_only).toBe(true);
});

test("every tool carries the exit-code contract the agent must branch on", () => {
  for (const tool of tools) {
    expect(tool.exitCodes.length).toBeGreaterThan(3);
    expect(tool.description).toContain("JSON report on stdout");
  }
});

test("a command's flags become tool inputs, with --json and --help excluded", () => {
  const ci = COMMAND_REGISTRY.find((command) => command.name === "ci");
  const tool = toolFor(ci as never);
  expect(Object.keys(tool.inputSchema.properties)).toContain("reporter");
  expect(Object.keys(tool.inputSchema.properties)).toContain("require_transaction_receipt");
  expect(Object.keys(tool.inputSchema.properties)).not.toContain("json");
  expect(Object.keys(tool.inputSchema.properties)).not.toContain("help");
});

test("a valued flag is a string input and a bare flag is a boolean", () => {
  const ci = toolFor(COMMAND_REGISTRY.find((command) => command.name === "ci") as never);
  expect(ci.inputSchema.properties.reporter?.type).toBe("string");
  expect(ci.inputSchema.properties.require_transaction_receipt?.type).toBe("boolean");
});

test("a required positional is required, and an optional one is not", () => {
  const explain = toolFor(COMMAND_REGISTRY.find((command) => command.name === "explain") as never);
  expect(explain.inputSchema.required).toContain("args");

  const scripts = toolFor(COMMAND_REGISTRY.find((command) => command.name === "scripts") as never);
  expect(scripts.inputSchema.required).not.toContain("args");
});

test("a positional with a fixed value set documents those values", () => {
  const scripts = toolFor(COMMAND_REGISTRY.find((command) => command.name === "scripts") as never);
  expect(scripts.inputSchema.properties.args?.description).toContain("pending");
});

test("tool inputs are closed, so a model cannot smuggle an extra argument", () => {
  for (const tool of tools) expect(tool.inputSchema.additionalProperties).toBe(false);
});

test("tools are sorted, so the manifest does not churn between runs", () => {
  expect(names).toEqual([...names].sort());
});

test("a tool call becomes the argv the CLI would have received", () => {
  expect(argvFor("warden_plan", { args: ["npm", "install", "left-pad"] })).toEqual([
    "plan",
    "npm",
    "install",
    "left-pad",
    "--json",
  ]);
});

test("a single string argument works as well as an array", () => {
  expect(argvFor("warden_explain", { args: "left-pad@1.3.0" })).toEqual([
    "explain",
    "left-pad@1.3.0",
    "--json",
  ]);
});

test("a boolean input becomes a bare flag and a false one is dropped", () => {
  expect(argvFor("warden_ci", { require_transaction_receipt: true })).toEqual([
    "ci",
    "--require-transaction-receipt",
    "--json",
  ]);
  expect(argvFor("warden_ci", { require_transaction_receipt: false })).toEqual(["ci", "--json"]);
});

test("a valued input becomes a flag and its value", () => {
  expect(argvFor("warden_ci", { reporter: "agent" })).toEqual([
    "ci",
    "--reporter",
    "agent",
    "--json",
  ]);
});

test("an underscored tool name maps back to the hyphenated command", () => {
  expect(argvFor("warden_approve_script", {})[0]).toBe("approve-script");
});

test("every call asks for json, because an agent must never parse the human text", () => {
  expect(argvFor("warden_detect", {}).at(-1)).toBe("--json");
  expect(argvFor("warden_plan", { args: ["x"] }).at(-1)).toBe("--json");
});

test("an undefined input is dropped rather than passed as the string undefined", () => {
  expect(argvFor("warden_ci", { reporter: undefined })).toEqual(["ci", "--json"]);
});

test("the exclusion list stays sorted and non-empty", () => {
  const excluded = excludedFromMcp(COMMAND_REGISTRY);
  expect(excluded.length).toBeGreaterThan(0);
  expect(excluded).toEqual([...excluded].sort());
});
