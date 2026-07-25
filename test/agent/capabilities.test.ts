import { expect, test } from "bun:test";
import {
  ADAPTERS,
  type AgentCapability,
  adapterFor,
  CAPABILITY_FALLBACK,
  enforcementLayers,
  instructionSection,
  SKILL_BODY,
  supports,
} from "../../src/agent/capabilities.ts";
import { AGENT_ADAPTERS } from "../../src/shared/agents.ts";

const CAPABILITIES: AgentCapability[] = [
  "instruction-file",
  "skill",
  "pre-command-hook",
  "post-change-hook",
  "mcp",
  "managed-settings",
];

test("every adapter the CLI can hand off to has a capability declaration", () => {
  for (const name of Object.keys(AGENT_ADAPTERS)) {
    expect(`${name}: ${Boolean(adapterFor(name))}`).toBe(`${name}: true`);
  }
});

test("the launch command in the capability model matches the handoff adapter", () => {
  for (const adapter of ADAPTERS) {
    expect(adapter.launch).toBe(AGENT_ADAPTERS[adapter.name] as string);
  }
});

test("an unknown agent has no adapter rather than a default one", () => {
  expect(adapterFor("not-an-agent")).toBeUndefined();
});

test("every declared capability is one of the known capabilities", () => {
  for (const adapter of ADAPTERS) {
    for (const capability of adapter.capabilities) expect(CAPABILITIES).toContain(capability);
  }
});

test("every capability has a documented fallback for agents that lack it", () => {
  for (const capability of CAPABILITIES) {
    expect(CAPABILITY_FALLBACK[capability].length).toBeGreaterThan(10);
  }
});

test("an agent that declares a hook config also declares the hook capability", () => {
  for (const adapter of ADAPTERS) {
    if (adapter.hookConfig) expect(supports(adapter, "pre-command-hook")).toBe(true);
  }
});

test("an agent that declares an mcp config also declares the mcp capability", () => {
  for (const adapter of ADAPTERS) {
    if (adapter.mcpConfig) expect(supports(adapter, "mcp")).toBe(true);
  }
});

test("an agent that declares a skill path also declares the skill capability", () => {
  for (const adapter of ADAPTERS) {
    if (adapter.skillPath) expect(supports(adapter, "skill")).toBe(true);
  }
});

test("claude and codex are the two agents with real command interception", () => {
  const intercepting = ADAPTERS.filter((adapter) => supports(adapter, "pre-command-hook")).map(
    (adapter) => adapter.name,
  );
  expect(intercepting.sort()).toEqual(["claude", "codex"]);
});

test("an agent with no hook support still reports the shim as its interception layer", () => {
  const copilot = adapterFor("copilot");
  const layers = enforcementLayers(copilot as never);
  expect(layers.join(" ")).toContain("PATH shim mediates the command instead");
});

test("an agent with hook support reports real interception", () => {
  const layers = enforcementLayers(adapterFor("claude") as never);
  expect(layers.join(" ")).toContain("mediated before it executes");
});

test("every agent ends with the CI backstop, which no agent can skip", () => {
  for (const adapter of ADAPTERS) {
    expect(enforcementLayers(adapter).at(-1)).toContain("require-transaction-receipt");
  }
});

test("the skill tells the agent to plan first and never to approve on the human's behalf", () => {
  expect(SKILL_BODY).toContain("warden plan --json");
  expect(SKILL_BODY).toContain("Do not approve on the human's behalf");
  expect(SKILL_BODY).toContain("0 allow, 10 warn or needs approval, 20 block, 30 analysis error");
});

test("the skill carries frontmatter an agent can index", () => {
  expect(SKILL_BODY.startsWith("---\nname: warden\n")).toBe(true);
  expect(SKILL_BODY).toContain("description:");
});

test("the instruction section carries a version marker so it can be updated in place", () => {
  const section = instructionSection("0.1.0");
  expect(section).toContain("warden-adapter-version: 0.1.0");
  expect(section).toContain("## Warden");
});

test("the instruction section warns against the bypass flags", () => {
  expect(instructionSection("0.1.0")).toContain("Never pass `--allow-unapproved`");
});

test("every adapter points at the documentation it was built against", () => {
  for (const adapter of ADAPTERS) {
    expect(adapter.reference).toStartWith("https://");
  }
});

test("no adapter claims a capability without somewhere to put it", () => {
  for (const adapter of ADAPTERS) {
    if (supports(adapter, "instruction-file")) expect(adapter.instructionFile).toBeDefined();
    if (supports(adapter, "skill")) expect(adapter.skillPath).toBeDefined();
    if (supports(adapter, "mcp")) expect(adapter.mcpConfig).toBeDefined();
  }
});
