import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { IntentReport } from "../../src/intent/types.ts";

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

const DEMO_IMAGE = [
  'import axios from "axios";',
  "const client = axios.create({});",
  "function applyRateLimit(request) {",
  "  client.throttle({ rate: 5 });",
  "  return request;",
  "}",
  "export { applyRateLimit };",
].join("\n");

const PAGINATION_IMAGE = Array.from(
  { length: 12 },
  (_, index) => `const page${index} = ${index};`,
).join("\n");

const DEMO_DIFF = [
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
  "diff --git a/pagination.ts b/pagination.ts",
  "index 3333333..4444444 100644",
  "--- a/pagination.ts",
  "+++ b/pagination.ts",
  "@@ -1,1 +1,12 @@",
  ...Array.from({ length: 12 }, (_, index) => `+const page${index} = ${index};`),
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
      claim: "Keep the retry logic",
      kind: "preservation",
      keywords: ["retry"],
      sourceText: "keep the retry logic",
    },
    {
      claim: "Log every rate-limited request",
      kind: "behavior",
      keywords: ["log"],
      sourceText: "log every rate-limited request",
    },
  ],
};

function llmDispatch(matchPayload: unknown, matchStatus = 200): (body: string) => Response {
  return (body: string) => {
    const parsed = JSON.parse(body) as {
      response_format: { json_schema: { name: string } };
    };
    const name = parsed.response_format.json_schema.name;
    if (name === "intent_claims") {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(CLAIMS_PAYLOAD) } }],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(matchPayload) } }],
      }),
      { status: matchStatus },
    );
  };
}

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cwd: () => "/repo",
    mkdir: () => undefined,
    writeFile: (path, data) => files.set(path, data),
    readFile: (path) => {
      if (path === "/repo/api-client.ts") return DEMO_IMAGE;
      if (path === "/repo/pagination.ts") return PAGINATION_IMAGE;
      throw new Error("ENOENT");
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff") return { exitCode: 0, stdout: DEMO_DIFF, stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    },
    ...over,
  };
  return { deps, out, err, files };
}

function mockLlm(dispatch: (body: string) => Response): void {
  globalThis.fetch = (async (_url: string, init: { body: string }) =>
    dispatch(init.body)) as unknown as typeof fetch;
}

test("warden intent check produces the full verdict report end to end", async () => {
  mockLlm(
    llmDispatch({
      matches: [{ claim_id: "c3", hunk_ids: [], status: "dropped" }],
    }),
  );
  const state = makeDeps();
  expect(
    await runWarden(["intent", "check", "--prompt", "add rate limiting", "--json"], state.deps),
  ).toBe(20);
  const report = JSON.parse(state.out.join("")) as IntentReport;
  expect(report.claims.map((row) => row.verdict)).toEqual(["delivered", "delivered", "dropped"]);
  expect(report.claims[0]!.origin).toBe("keyword");
  expect(report.claims[1]!.origin).toBe("preservation");
  expect(report.scope_creep[0]!.file).toBe("pagination.ts");
  expect(report.hallucinations[0]!.symbol).toBe("axios.instance.throttle");
  expect(report.verdict).toBe("block");
  expect(report.llm).toEqual({ extract_calls: 1, match_calls: 1 });
  expect(state.files.get("/repo/.warden/claims.json")).toContain('"c1"');
  expect(state.files.get("/repo/.warden/intent-report.json")).toContain('"block"');
  const rendered = state.err.join("");
  expect(rendered).toContain("intent claims (3):");
  expect(rendered).toContain("DROPPED: Log every rate-limited request");
  expect(rendered).toContain("SCOPE CREEP: pagination.ts");
  expect(rendered).toContain("HALLUCINATED: axios.instance.throttle");
});

test("warden intent check reads the prompt from .warden/prompt.txt", async () => {
  mockLlm(llmDispatch({ matches: [{ claim_id: "c3", hunk_ids: [], status: "dropped" }] }));
  const state = makeDeps();
  const baseRead = state.deps.readFile;
  state.deps.readFile = (path) =>
    path === "/repo/.warden/prompt.txt" ? "add rate limiting\n" : baseRead(path);
  expect(await runWarden(["intent", "check"], state.deps)).toBe(20);
});

test("warden intent check requires a prompt from somewhere", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "check"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("no prompt provided");
});

test("warden intent check degrades to warn when the match llm fails", async () => {
  mockLlm(llmDispatch("not json", 500));
  const state = makeDeps({
    git: (args) => {
      if (args[0] === "diff") {
        return {
          exitCode: 0,
          stdout: DEMO_DIFF.split("\n")
            .filter((line) => !line.startsWith("+const page"))
            .join("\n"),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
    },
  });
  expect(await runWarden(["intent", "check", "--prompt", "add rate limiting"], state.deps)).toBe(
    20,
  );
  const written = JSON.parse(state.files.get("/repo/.warden/intent-report.json")!) as IntentReport;
  expect(written.claims[2]).toMatchObject({
    verdict: "partial",
    origin: "none",
  });
  expect(written.hallucinations).toHaveLength(1);
});

test("warden intent check surfaces extract failures as analysis errors", async () => {
  globalThis.fetch = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
  const state = makeDeps();
  expect(await runWarden(["intent", "check", "--prompt", "add x"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("groq 503");
});

test("warden intent check exits clean when everything is delivered", async () => {
  mockLlm(llmDispatch({ matches: [{ claim_id: "c3", hunk_ids: ["h1"], status: "delivered" }] }));
  const cleanImage = [
    'import axios from "axios";',
    "const client = axios.create({});",
    "function applyRateLimit(request) {",
    "  return request;",
    "}",
    "export { applyRateLimit };",
  ].join("\n");
  const cleanDiff = [
    "diff --git a/api-client.ts b/api-client.ts",
    "index 1111111..2222222 100644",
    "--- a/api-client.ts",
    "+++ b/api-client.ts",
    "@@ -1,3 +1,6 @@",
    ' import axios from "axios";',
    " const client = axios.create({});",
    "-export {};",
    "+function applyRateLimit(request) {",
    "+  return request;",
    "+}",
    "+export { applyRateLimit };",
    "",
  ].join("\n");
  const state = makeDeps({
    readFile: (path) => {
      if (path === "/repo/api-client.ts") return cleanImage;
      throw new Error("ENOENT");
    },
    git: (args) => {
      if (args[0] === "diff") return { exitCode: 0, stdout: cleanDiff, stderr: "" };
      return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
    },
  });
  expect(await runWarden(["intent", "check", "--prompt", "add rate limiting"], state.deps)).toBe(0);
  const written = JSON.parse(state.files.get("/repo/.warden/intent-report.json")!) as IntentReport;
  expect(written.verdict).toBe("allow");
  expect(written.claims.map((row) => row.verdict)).toEqual(["delivered", "delivered", "delivered"]);
});
