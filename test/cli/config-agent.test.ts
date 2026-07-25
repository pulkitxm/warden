import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { AGENT_ADAPTERS, AGENT_NAMES, DEFAULT_AGENT } from "../../src/shared/agents.ts";

function makeDeps(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/u",
    cwd: () => "/repo",
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    mkdir: () => undefined,
    writeFile: (path, data) => written.set(path, String(data)),
    exists: (path) => path in files || written.has(path),
    readFile: (path) => {
      if (written.has(path)) return written.get(path) as string;
      if (path in files) return files[path] as string;
      throw new Error(`ENOENT ${path}`);
    },
  };
  return { deps, out, err, written };
}

test("every adapter name has a launch command and claude is the default", () => {
  expect(AGENT_NAMES.length).toBeGreaterThan(0);
  for (const name of AGENT_NAMES) expect(AGENT_ADAPTERS[name]).toBeTruthy();
  expect(AGENT_NAMES).toContain(DEFAULT_AGENT);
});

test("warden config agent persists the choice", async () => {
  const { deps, err, written } = makeDeps();
  expect(await runWarden(["config", "agent", "codex"], deps)).toBe(0);
  expect(err.join("")).toContain("agent set to codex");
  const saved = JSON.parse(written.get("/home/u/.warden/config.json") as string);
  expect(saved.agent).toEqual({ name: "codex" });
  expect(saved.mode).toBe("brief");
});

test("every documented adapter is accepted", async () => {
  for (const name of AGENT_NAMES) {
    const { deps } = makeDeps();
    expect(await runWarden(["config", "agent", name], deps)).toBe(0);
  }
});

test("an unknown agent is rejected and names the known ones", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["config", "agent", "nope"], deps)).toBe(30);
  const text = err.join("");
  expect(text).toContain('unknown agent "nope"');
  for (const name of AGENT_NAMES) expect(text).toContain(name);
});

test("agent without a value is still an invalid config command", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["config", "agent"], deps)).toBe(30);
  expect(err.join("")).toContain("invalid config command");
});

test("setting the agent does not disturb mode or intercept", async () => {
  const { deps, written } = makeDeps();
  await runWarden(["config", "mode", "block"], deps);
  await runWarden(["config", "intercept", "off"], deps);
  await runWarden(["config", "agent", "aider"], deps);
  const saved = JSON.parse(written.get("/home/u/.warden/config.json") as string);
  expect(saved.mode).toBe("block");
  expect(saved.intercept).toEqual({ install: false, exec: false });
  expect(saved.agent).toEqual({ name: "aider" });
});

test("warden fix launches the configured agent", async () => {
  const { deps, err } = makeDeps({
    "/home/u/.warden/config.json": JSON.stringify({
      mode: "brief",
      intercept: { install: true, exec: true },
      agent: { name: "gemini" },
    }),
    "/repo/.warden/last-run.json": JSON.stringify({
      schema_version: 1,
      findings: [
        {
          schema_version: 1,
          rule: "r",
          package: "p@1.0.0",
          file: "package.json",
          level: "block",
          evidence: "e",
          fix: "f",
          verify: "warden ci --reporter agent",
          seen_before: false,
        },
      ],
      verdict: "block",
      exit: 20,
    }),
  });
  expect(await runWarden(["fix"], deps)).toBe(0);
  expect(err.join("")).toContain(AGENT_ADAPTERS.gemini as string);
});

test("warden fix falls back to the default agent when none is configured", async () => {
  const { deps, err } = makeDeps({
    "/repo/.warden/last-run.json": JSON.stringify({
      schema_version: 1,
      findings: [
        {
          schema_version: 1,
          rule: "r",
          package: "p@1.0.0",
          file: "package.json",
          level: "block",
          evidence: "e",
          fix: "f",
          verify: "warden ci --reporter agent",
          seen_before: false,
        },
      ],
      verdict: "block",
      exit: 20,
    }),
  });
  expect(await runWarden(["fix"], deps)).toBe(0);
  expect(err.join("")).toContain(AGENT_ADAPTERS[DEFAULT_AGENT] as string);
});

test("config completions offer the agent subcommand", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["completions", "zsh"], deps);
  expect(out.join("")).toContain("agent");
});
