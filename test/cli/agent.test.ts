import { expect, test } from "bun:test";
import { join } from "node:path";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";

function makeDeps(files: Record<string, string> = {}, onPath: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const dirs: string[] = [];
  const store = { ...files };
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => CWD,
    home: "/home/u",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in store,
    readFile: (path) => {
      if (!(path in store)) throw new Error(`ENOENT ${path}`);
      return store[path] as string;
    },
    mkdir: (path) => dirs.push(path),
    writeFile: (path, data) => {
      written[path] = data;
      store[path] = data;
    },
    which: (cmd) => (onPath.includes(cmd) ? `/usr/bin/${cmd}` : null),
    check: () => Promise.reject(new Error("unused")),
  };
  return { deps, out, err, written, dirs };
}

test("agent doctor reports every known adapter", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["agent", "doctor", "--json"], deps)).toBe(0);
  const agents = JSON.parse(out[0] as string).agents;
  expect(agents.map((agent: { agent: string }) => agent.agent)).toContain("claude");
  expect(agents.map((agent: { agent: string }) => agent.agent)).toContain("codex");
});

test("bare agent behaves as doctor", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  expect(await runWarden(["agent"], deps)).toBe(0);
  expect(err.join("")).toContain("Warden agent integration");
});

test("an installed agent is detected and an absent one is not", async () => {
  const { deps, out } = makeDeps({}, ["claude"]);
  await runWarden(["agent", "doctor", "--json"], deps);
  const agents = JSON.parse(out[0] as string).agents as Array<{ agent: string; detected: boolean }>;
  expect(agents.find((agent) => agent.agent === "claude")?.detected).toBe(true);
  expect(agents.find((agent) => agent.agent === "aider")?.detected).toBe(false);
});

test("setup plans without writing anything until --yes is passed", async () => {
  const { deps, out, written } = makeDeps();
  expect(await runWarden(["agent", "setup", "claude", "--json"], deps)).toBe(0);
  const payload = JSON.parse(out[0] as string);
  expect(payload.applied).toBe(false);
  expect(written).toEqual({});
  expect(payload.agents[0].changes.map((change: { file: string }) => change.file)).toContain(
    "CLAUDE.md",
  );
});

test("--yes writes the instruction file and the skill", async () => {
  const { deps, written, dirs } = makeDeps();
  expect(await runWarden(["agent", "setup", "claude", "--yes"], deps)).toBe(0);
  expect(written[join(CWD, "CLAUDE.md")]).toContain("## Warden");
  expect(written[join(CWD, ".claude/skills/warden/SKILL.md")]).toContain("name: warden");
  expect(dirs.some((dir) => dir.includes("skills"))).toBe(true);
});

test("an existing instruction file is appended to, not overwritten", async () => {
  const { deps, written } = makeDeps({ [join(CWD, "CLAUDE.md")]: "# My project\n\nNotes here.\n" });
  await runWarden(["agent", "setup", "claude", "--yes"], deps);
  const text = written[join(CWD, "CLAUDE.md")] as string;
  expect(text).toContain("# My project");
  expect(text).toContain("Notes here.");
  expect(text).toContain("## Warden");
});

test("a second setup is idempotent because of the version marker", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "CLAUDE.md")]: "# Project\n\n## Warden\n\n<!-- warden-adapter-version: 0.1.0 -->\n",
  });
  await runWarden(["agent", "setup", "claude", "--json"], deps);
  const changes = JSON.parse(out[0] as string).agents[0].changes;
  expect(changes.find((change: { file: string }) => change.file === "CLAUDE.md").action).toBe(
    "skip",
  );
});

test("an existing skill is not rewritten", async () => {
  const { deps, out } = makeDeps({ [join(CWD, ".claude/skills/warden/SKILL.md")]: "old" });
  await runWarden(["agent", "setup", "claude", "--json"], deps);
  const changes = JSON.parse(out[0] as string).agents[0].changes;
  expect(
    changes.find((change: { capability: string }) => change.capability === "skill").action,
  ).toBe("skip");
});

test("mcp and hook configuration are never rewritten automatically", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["agent", "setup", "claude", "--json"], deps);
  const changes = JSON.parse(out[0] as string).agents[0].changes as Array<{
    capability: string;
    action: string;
    reason: string;
  }>;
  const mcp = changes.find((change) => change.capability === "mcp");
  const hook = changes.find((change) => change.capability === "pre-command-hook");
  expect(mcp?.action).toBe("skip");
  expect(hook?.action).toBe("skip");
  expect(hook?.reason).toContain("never rewrites settings it does not own");
});

test("--all sets up every adapter at once", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["agent", "setup", "--all", "--json"], deps);
  expect(JSON.parse(out[0] as string).agents.length).toBeGreaterThan(5);
});

test("setup without a target is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["agent", "setup", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_AGENT_TARGET");
});

test("an unknown agent name is rejected with the list of known ones", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["agent", "setup", "nonsense", "--json"], deps)).toBe(30);
  const error = JSON.parse(out[0] as string).error;
  expect(error.code).toBe("WARDEN_AGENT_UNKNOWN");
  expect(error.hint).toContain("claude");
});

test("an unknown subcommand is rejected", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["agent", "nonsense", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_AGENT_USAGE");
});

test("an unwritable repository is reported rather than half-applied", async () => {
  const { deps, out } = makeDeps();
  deps.writeFile = () => {
    throw new Error("read-only");
  };
  expect(await runWarden(["agent", "setup", "claude", "--yes", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_AGENT_WRITE");
});

test("agent mcp prints a manifest generated from the command registry", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["agent", "mcp", "--json"], deps)).toBe(0);
  const manifest = JSON.parse(out.join(""));
  expect(manifest.name).toBe("warden");
  expect(manifest.read_only).toBe(true);
  expect(manifest.tools.map((tool: { name: string }) => tool.name)).toContain("warden_plan");
});

test("the human mcp listing names what is deliberately not exposed", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["agent", "mcp"], deps);
  const text = err.join("");
  expect(text).toContain("Warden MCP tools");
  expect(text).toContain("Deliberately not exposed");
  expect(text).toContain("cannot drift");
});

test("the human setup report states what was not supported and how it is covered", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["agent", "setup", "copilot"], deps);
  const text = err.join("");
  expect(text).toContain("Warden adapter for copilot");
  expect(text).toContain("Not supported by this agent");
  expect(text).toContain("PATH shim mediates the command instead");
  expect(text).toContain("nothing was written");
});

test("the doctor points at the setup command for a detected but unconfigured agent", async () => {
  setColor(false);
  const { deps, err } = makeDeps({}, ["claude"]);
  await runWarden(["agent", "doctor"], deps);
  expect(err.join("")).toContain("warden agent setup claude --yes");
});

test("--quiet suppresses every human report in the agent family", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  await runWarden(["agent", "doctor"], deps);
  await runWarden(["agent", "mcp"], deps);
  await runWarden(["agent", "setup", "claude"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("a corrupt instruction file is treated as not yet configured rather than crashing", async () => {
  const { deps, out } = makeDeps();
  deps.exists = (path) => path === join(CWD, "CLAUDE.md");
  deps.readFile = () => {
    throw new Error("EACCES");
  };
  expect(await runWarden(["agent", "setup", "claude", "--json"], deps)).toBe(0);
  const changes = JSON.parse(out[0] as string).agents[0].changes;
  expect(changes.find((change: { file: string }) => change.file === "CLAUDE.md").action).toBe(
    "append",
  );
});
