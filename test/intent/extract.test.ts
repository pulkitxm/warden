import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { claimsSchema, extractClaims, parseClaims } from "../../src/intent/extract.ts";

const ENV_KEYS = ["OPENAI_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "WNPM_LLM_PROVIDER"];
const saved = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

const VALID_CLAIM = {
  claim: "Add rate limiting to the API client",
  kind: "behavior",
  keywords: ["Rate", "limit"],
  sourceText: "add rate limiting",
};

function llmResponding(payload: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: { content: JSON.stringify(payload) } }), {
      status: 200,
    })) as unknown as typeof fetch;
}

test("claimsSchema requires the claims array with all four fields", () => {
  const schema = claimsSchema() as {
    required: string[];
    properties: { claims: { items: { required: string[] } } };
  };
  expect(schema.required).toEqual(["claims"]);
  expect(schema.properties.claims.items.required).toEqual([
    "claim",
    "kind",
    "keywords",
    "sourceText",
  ]);
});

test("parseClaims accepts a valid payload and normalizes it", () => {
  const parsed = parseClaims({ claims: [{ ...VALID_CLAIM, claim: "  Add rate limiting  " }] });
  expect(parsed).toEqual([
    {
      claim: "Add rate limiting",
      kind: "behavior",
      keywords: ["rate", "limit"],
      sourceText: "add rate limiting",
    },
  ]);
});

test("parseClaims rejects every malformed shape", () => {
  expect(parseClaims(null)).toBeNull();
  expect(parseClaims("text")).toBeNull();
  expect(parseClaims({})).toBeNull();
  expect(parseClaims({ claims: [] })).toEqual([]);
  expect(parseClaims({ claims: ["nope"] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, claim: "  " }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, claim: 7 }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, kind: "vibe" }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, kind: 3 }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, keywords: "rate" }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, keywords: [1] }] })).toBeNull();
  expect(parseClaims({ claims: [{ ...VALID_CLAIM, sourceText: 9 }] })).toBeNull();
});

test("extractClaims assigns sequential ids and echoes the prompt", async () => {
  process.env.OLLAMA_API_KEY = "ok-test";
  llmResponding({
    claims: [VALID_CLAIM, { ...VALID_CLAIM, claim: "Keep the retry logic", kind: "preservation" }],
  });
  const ledger = await extractClaims("add rate limiting, keep the retry logic");
  expect(ledger.source_text).toBe("add rate limiting, keep the retry logic");
  expect(ledger.claims.map((claim) => claim.id)).toEqual(["c1", "c2"]);
  expect(ledger.claims[1]!.kind).toBe("preservation");
});

function makeDeps() {
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
  };
  return { deps, out, err, files };
}

test("warden intent extract writes the ledger and renders claims", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ claims: [VALID_CLAIM] }) } }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const state = makeDeps();
  expect(
    await runWarden(["intent", "extract", "--prompt", "add rate limiting", "--json"], state.deps),
  ).toBe(0);
  const ledger = JSON.parse(state.out.join("")) as { claims: Array<{ id: string }> };
  expect(ledger.claims[0]!.id).toBe("c1");
  expect(state.files.get("/repo/.warden/claims.json")).toContain('"c1"');
  expect(state.err.join("")).toContain("intent claims (1):");
  expect(state.err.join("")).toContain("[behavior]");
});

test("warden intent extract without a prompt is a usage error", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "extract"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("no prompt provided");
});

test("warden intent extract surfaces llm failures as analysis errors", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  globalThis.fetch = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
  const state = makeDeps();
  expect(await runWarden(["intent", "extract", "--prompt", "add x"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("groq 429");
});
