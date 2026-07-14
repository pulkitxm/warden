import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cliError,
  completeJson,
  contentOf,
  extractJson,
  intentLlmStats,
  requestBody,
  resolveProvider,
} from "../../src/intent/llm.ts";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "OLLAMA_API_KEY",
  "WNPM_LLM_PROVIDER",
  "WNPM_LLM_MODEL",
  "WNPM_CLAUDE_BIN",
  "CLAUDE_STUB_OUTPUT",
  "CLAUDE_STUB_EXIT",
  "WNPM_CODEX_BIN",
  "CODEX_STUB_OUTPUT",
  "CODEX_STUB_EXIT",
];
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

test("resolveProvider throws when no key is configured", () => {
  expect(() => resolveProvider({})).toThrow("no llm api key configured");
});

test("resolveProvider picks each provider from its key", () => {
  expect(resolveProvider({ OLLAMA_API_KEY: "k" })).toEqual({
    name: "ollama",
    key: "k",
    url: "https://ollama.com/api/chat",
    model: "gpt-oss:20b",
  });
  expect(resolveProvider({ GROQ_API_KEY: "g" }).model).toBe("openai/gpt-oss-20b");
  expect(resolveProvider({ OPENAI_API_KEY: "o" }).url).toContain("api.openai.com");
});

test("resolveProvider prefers openai, then groq, then ollama", () => {
  const env = { OPENAI_API_KEY: "o", GROQ_API_KEY: "g", OLLAMA_API_KEY: "k" };
  expect(resolveProvider(env).name).toBe("openai");
  expect(resolveProvider({ GROQ_API_KEY: "g", OLLAMA_API_KEY: "k" }).name).toBe("groq");
});

test("WNPM_LLM_PROVIDER forces a provider and requires its key", () => {
  const env = { WNPM_LLM_PROVIDER: "ollama", OLLAMA_API_KEY: "k", OPENAI_API_KEY: "o" };
  expect(resolveProvider(env).name).toBe("ollama");
  expect(() => resolveProvider({ WNPM_LLM_PROVIDER: "groq" })).toThrow("GROQ_API_KEY is not set");
  expect(() => resolveProvider({ WNPM_LLM_PROVIDER: "bogus" })).toThrow(
    'unknown llm provider "bogus"',
  );
});

test("WNPM_LLM_MODEL overrides the provider default", () => {
  expect(resolveProvider({ OLLAMA_API_KEY: "k", WNPM_LLM_MODEL: "qwen3" }).model).toBe("qwen3");
});

test("WNPM_LLM_PROVIDER=claude uses the claude cli without any key", () => {
  expect(resolveProvider({ WNPM_LLM_PROVIDER: "claude" })).toEqual({
    name: "claude",
    key: "",
    url: "claude",
    model: "haiku",
  });
  const custom = resolveProvider({
    WNPM_LLM_PROVIDER: "claude",
    WNPM_CLAUDE_BIN: "/opt/claude",
    WNPM_LLM_MODEL: "sonnet",
  });
  expect(custom.url).toBe("/opt/claude");
  expect(custom.model).toBe("sonnet");
});

test("WNPM_LLM_PROVIDER=codex uses the codex cli without any key", () => {
  expect(resolveProvider({ WNPM_LLM_PROVIDER: "codex" })).toEqual({
    name: "codex",
    key: "",
    url: "codex",
    model: "",
  });
  const custom = resolveProvider({
    WNPM_LLM_PROVIDER: "codex",
    WNPM_CODEX_BIN: "/opt/codex",
    WNPM_LLM_MODEL: "gpt-5-codex",
  });
  expect(custom.url).toBe("/opt/codex");
  expect(custom.model).toBe("gpt-5-codex");
});

const REQUEST = {
  system: "sys",
  user: "usr",
  schemaName: "probe",
  schema: { type: "object" } as Record<string, unknown>,
};

test("requestBody shapes ollama native and openai-compatible payloads", () => {
  const ollama = resolveProvider({ OLLAMA_API_KEY: "k" });
  expect(requestBody(ollama, REQUEST)).toEqual({
    model: "gpt-oss:20b",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ],
    stream: false,
    format: { type: "object" },
    options: { temperature: 0 },
  });
  const groq = resolveProvider({ GROQ_API_KEY: "g" });
  const body = requestBody(groq, REQUEST) as {
    response_format: { type: string; json_schema: { name: string; strict: boolean } };
  };
  expect(body.response_format.type).toBe("json_schema");
  expect(body.response_format.json_schema.name).toBe("probe");
  expect(body.response_format.json_schema.strict).toBe(true);
});

test("contentOf reads each provider shape and tolerates absence", () => {
  const ollama = resolveProvider({ OLLAMA_API_KEY: "k" });
  const groq = resolveProvider({ GROQ_API_KEY: "g" });
  expect(contentOf(ollama, { message: { content: "hi" } })).toBe("hi");
  expect(contentOf(ollama, {})).toBe("");
  expect(contentOf(groq, { choices: [{ message: { content: "yo" } }] })).toBe("yo");
  expect(contentOf(groq, { choices: [] })).toBe("");
});

test("extractJson finds the first balanced object and rejects the rest", () => {
  expect(extractJson('{"a":1}')).toBe('{"a":1}');
  expect(extractJson('noise {"a":{"b":2}} tail')).toBe('{"a":{"b":2}}');
  expect(extractJson('{"s":"}\\""}')).toBe('{"s":"}\\""}');
  expect(extractJson("no json here")).toBeNull();
  expect(extractJson('{"a":')).toBeNull();
});

test("completeJson calls groq and returns the parsed payload", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    requests.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'x {"ok":true} y' } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const before = intentLlmStats.calls;
  const result = await completeJson(REQUEST, (value) => value as { ok: boolean });
  expect(result).toEqual({ ok: true });
  expect(intentLlmStats.calls).toBe(before + 1);
  expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
  expect(requests[0]!.body.model).toBe("openai/gpt-oss-20b");
});

test("completeJson calls ollama with the native format field", async () => {
  process.env.OLLAMA_API_KEY = "ok-test";
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify({ message: { content: '{"ok":false}' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await completeJson(REQUEST, (value) => value as { ok: boolean });
  expect(result).toEqual({ ok: false });
  expect(bodies[0]!.format).toEqual({ type: "object" });
  expect(bodies[0]!.stream).toBe(false);
});

test("completeJson surfaces http, missing-json, and invalid-payload failures", async () => {
  process.env.GROQ_API_KEY = "gsk-test";
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("groq 500: nope");

  globalThis.fetch = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("groq 429");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "plain text" } }] }), {
      status: 200,
    })) as unknown as typeof fetch;
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("no json in llm response");

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"bad":1}' } }] }), {
      status: 200,
    })) as unknown as typeof fetch;
  expect(completeJson(REQUEST, () => null)).rejects.toThrow("invalid llm payload");
});

test("completeJson shells out to the claude cli and parses fenced json", async () => {
  process.env.WNPM_LLM_PROVIDER = "claude";
  process.env.WNPM_CLAUDE_BIN = join(import.meta.dir, "../../fixtures/claude-stub.sh");
  process.env.CLAUDE_STUB_OUTPUT = '```json\n{"ok":true}\n```';
  const before = intentLlmStats.calls;
  const result = await completeJson(REQUEST, (value) => value as { ok: boolean });
  expect(result).toEqual({ ok: true });
  expect(intentLlmStats.calls).toBe(before + 1);
});

test("completeJson surfaces a nonzero claude exit code", async () => {
  process.env.WNPM_LLM_PROVIDER = "claude";
  process.env.WNPM_CLAUDE_BIN = join(import.meta.dir, "../../fixtures/claude-stub.sh");
  process.env.CLAUDE_STUB_EXIT = "3";
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("claude 3");
});

test("cliError appends trimmed stderr only when present", () => {
  expect(cliError("claude", 3, "boom\n")).toBe("claude 3: boom");
  expect(cliError("codex", 4, "  spaced  \n  detail ")).toBe("codex 4: spaced detail");
  expect(cliError("claude", 1, "   ")).toBe("claude 1");
});

test("completeJson shells out to the codex cli and parses its final message", async () => {
  process.env.WNPM_LLM_PROVIDER = "codex";
  process.env.WNPM_CODEX_BIN = join(import.meta.dir, "../../fixtures/codex-stub.sh");
  process.env.WNPM_LLM_MODEL = "gpt-5-codex";
  process.env.CODEX_STUB_OUTPUT = 'here is the result {"ok":true}';
  const before = intentLlmStats.calls;
  const result = await completeJson(REQUEST, (value) => value as { ok: boolean });
  expect(result).toEqual({ ok: true });
  expect(intentLlmStats.calls).toBe(before + 1);
});

test("completeJson surfaces a nonzero codex exit code", async () => {
  process.env.WNPM_LLM_PROVIDER = "codex";
  process.env.WNPM_CODEX_BIN = join(import.meta.dir, "../../fixtures/codex-stub.sh");
  process.env.CODEX_STUB_EXIT = "4";
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("codex 4");
});

test("completeJson throws before fetching when no key is set", async () => {
  const before = intentLlmStats.calls;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  expect(completeJson(REQUEST, (value) => value)).rejects.toThrow("no llm api key configured");
  expect(fetched).toBe(false);
  expect(intentLlmStats.calls).toBe(before);
});
