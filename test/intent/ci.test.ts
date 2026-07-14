import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { IntentReport } from "../../src/intent/types.ts";
import type { Verdict } from "../../src/schema.ts";

const ENV_KEYS = ["OPENAI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "WNPM_LLM_PROVIDER"];
const saved = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.GROQ_API_KEY = "gsk-test";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

const IMAGE = [
  'import axios from "axios";',
  "const client = axios.create({});",
  "function applyRateLimit(request) {",
  "  client.throttle({ rate: 5 });",
  "  return request;",
  "}",
  "export { applyRateLimit };",
].join("\n");

const DIFF = [
  "diff --git a/api-client.ts b/api-client.ts",
  "index 1111111..2222222 100644",
  "--- a/api-client.ts",
  "+++ b/api-client.ts",
  "@@ -1,3 +1,7 @@",
  ' import axios from "axios";',
  " const client = axios.create({});",
  "-export {};",
  "+function applyRateLimit(request) {",
  "+  client.throttle({ rate: 5 });",
  "+  return request;",
  "+}",
  "+export { applyRateLimit };",
  "",
].join("\n");

const CLAIMS_PAYLOAD = {
  claims: [
    {
      claim: "Add rate limiting to the API client",
      kind: "behavior",
      keywords: ["rate", "limit"],
      sourceText: "add rate limiting",
    },
    {
      claim: "Log every rate-limited request",
      kind: "behavior",
      keywords: ["log"],
      sourceText: "log every rate-limited request",
    },
  ],
};

function mockLlm(): void {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const parsed = JSON.parse(init.body) as { response_format: { json_schema: { name: string } } };
    const payload =
      parsed.response_format.json_schema.name === "intent_claims"
        ? CLAIMS_PAYLOAD
        : { matches: [{ claim_id: "c2", hunk_ids: [], status: "dropped" }] };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

function verdict(spec: string, level: Verdict["verdict"]): Verdict {
  const [name, version] = spec.split("@");
  return {
    schema_version: 1,
    package: name ?? spec,
    version: version ?? "1.0.0",
    integrity: "sha512-x",
    verdict: level,
    risk_score: level === "block" ? 90 : 0,
    categories: level === "block" ? ["typosquat"] : [],
    summary: "",
    evidence: [],
    analyzer_version: "0.1.0",
    source: "heuristics",
  };
}

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    check: (spec) => Promise.resolve(verdict(spec, "allow")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cwd: () => "/repo",
    exists: () => false,
    mkdir: () => undefined,
    writeFile: (path, data) => files.set(path, data),
    readFile: (path) => {
      if (path === "/repo/api-client.ts") return IMAGE;
      throw new Error("ENOENT");
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff" && args[1] === "--name-only")
        return { exitCode: 0, stdout: "api-client.ts\n", stderr: "" };
      if (args[0] === "diff") return { exitCode: 0, stdout: DIFF, stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    },
    ...over,
  };
  return { deps, out, err, files };
}

test("warden ci runs the intent pass and merges the verdicts", async () => {
  mockLlm();
  const state = makeDeps();
  expect(
    await runWarden(
      ["ci", "--reporter", "agent", "--intent-prompt", "add rate limiting"],
      state.deps,
    ),
  ).toBe(20);
  const envelope = JSON.parse(state.out.join("")) as {
    findings: unknown[];
    intent: IntentReport;
    verdict: string;
    exit: number;
  };
  expect(envelope.findings).toEqual([]);
  expect(envelope.intent.hallucinations[0]!.symbol).toBe("axios.instance.throttle");
  expect(envelope.verdict).toBe("block");
  expect(state.files.get("/repo/.warden/last-run.json")).toContain('"intent"');
});

test("warden ci without a prompt behaves exactly as before", async () => {
  const state = makeDeps();
  expect(await runWarden(["ci", "--reporter", "agent"], state.deps)).toBe(0);
  const envelope = JSON.parse(state.out.join("")) as Record<string, unknown>;
  expect(envelope.intent).toBeUndefined();
  expect(envelope.verdict).toBe("allow");
});

test("warden ci skips intent when no js files changed", async () => {
  mockLlm();
  const state = makeDeps({
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff" && args[1] === "--name-only")
        return { exitCode: 0, stdout: "README.md\n", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(await runWarden(["ci", "--intent-prompt", "add rate limiting"], state.deps)).toBe(0);
  expect(state.err.join("")).not.toContain("intent  ");
});

test("warden ci reads the intent prompt from .warden/prompt.txt", async () => {
  mockLlm();
  const state = makeDeps();
  state.deps.exists = (path) => path === "/repo/.warden/prompt.txt";
  const baseRead = state.deps.readFile;
  state.deps.readFile = (path) =>
    path === "/repo/.warden/prompt.txt" ? "add rate limiting\n" : baseRead(path);
  expect(await runWarden(["ci"], state.deps)).toBe(20);
  expect(state.err.join("")).toContain("intent  ");
});

test("warden ci github reporter annotates dropped claims and hallucinations", async () => {
  mockLlm();
  const state = makeDeps();
  expect(
    await runWarden(
      ["ci", "--reporter", "github", "--intent-prompt", "add rate limiting"],
      state.deps,
    ),
  ).toBe(20);
  const annotations = state.out.join("");
  expect(annotations).toContain("::error ::intent: dropped requirement: Log every rate-limited");
  expect(annotations).toContain("::error file=api-client.ts,line=4::intent: hallucinated api");
  expect(state.err.join("")).toContain("intent  1 ✅ · 1 ❌ · 0 ⚠️ · 1 🚨");
});

test("warden ci keeps the guard verdict when it outranks intent", async () => {
  mockLlm();
  const state = makeDeps({
    check: (spec) => Promise.resolve(verdict(spec, "block")),
    readFile: (path) => {
      if (path === "/repo/api-client.ts") return IMAGE;
      if (path === "/repo/package.json") return '{"dependencies":{"expres":"1.0.0"}}';
      throw new Error("ENOENT");
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff" && args[1] === "--name-only")
        return { exitCode: 0, stdout: "package.json\nREADME.md\n", stderr: "" };
      if (args[0] === "show") return { exitCode: 0, stdout: "{}", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(await runWarden(["ci", "--reporter", "agent"], state.deps)).toBe(20);
  const envelope = JSON.parse(state.out.join("")) as { verdict: string; intent?: unknown };
  expect(envelope.verdict).toBe("block");
  expect(envelope.intent).toBeUndefined();
});
