export const intentLlmStats = { calls: 0 };

export type ProviderName = "openai" | "groq" | "ollama";

export interface Provider {
  name: ProviderName;
  key: string;
  url: string;
  model: string;
}

export interface LlmJsonRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

const PROVIDER_ORDER: ProviderName[] = ["openai", "groq", "ollama"];

const PROVIDER_KEYS: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const PROVIDER_URLS: Record<ProviderName, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  ollama: "https://ollama.com/api/chat",
};

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  groq: "openai/gpt-oss-20b",
  ollama: "gpt-oss:20b",
};

export function resolveProvider(env: Record<string, string | undefined>): Provider {
  let name: ProviderName;
  if (env.WNPM_LLM_PROVIDER !== undefined) {
    const forced = env.WNPM_LLM_PROVIDER as ProviderName;
    if (!PROVIDER_ORDER.includes(forced)) {
      throw new Error(`unknown llm provider "${env.WNPM_LLM_PROVIDER}"`);
    }
    name = forced;
  } else {
    const found = PROVIDER_ORDER.find((candidate) => env[PROVIDER_KEYS[candidate]]);
    if (!found) {
      throw new Error(
        "no llm api key configured (set GROQ_API_KEY, OLLAMA_API_KEY, or OPENAI_API_KEY)",
      );
    }
    name = found;
  }
  const key = env[PROVIDER_KEYS[name]];
  if (!key) throw new Error(`${PROVIDER_KEYS[name]} is not set`);
  return {
    name,
    key,
    url: PROVIDER_URLS[name],
    model: env.WNPM_LLM_MODEL ?? DEFAULT_MODELS[name],
  };
}

export function requestBody(provider: Provider, request: LlmJsonRequest): Record<string, unknown> {
  const messages = [
    { role: "system", content: request.system },
    { role: "user", content: request.user },
  ];
  if (provider.name === "ollama") {
    return {
      model: provider.model,
      messages,
      stream: false,
      format: request.schema,
      options: { temperature: 0 },
    };
  }
  return {
    model: provider.model,
    messages,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName, strict: true, schema: request.schema },
    },
  };
}

export function contentOf(provider: Provider, data: unknown): string {
  if (provider.name === "ollama") {
    return String((data as { message?: { content?: unknown } }).message?.content ?? "");
  }
  const body = data as { choices?: Array<{ message?: { content?: unknown } }> };
  return String(body.choices?.[0]?.message?.content ?? "");
}

export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export async function completeJson<T>(
  request: LlmJsonRequest,
  parse: (value: unknown) => T | null,
): Promise<T> {
  const provider = resolveProvider(process.env);
  intentLlmStats.calls += 1;
  const res = await fetch(provider.url, {
    method: "POST",
    headers: { authorization: `Bearer ${provider.key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify(requestBody(provider, request)),
  });
  if (!res.ok) throw new Error(`${provider.name} ${res.status}`);
  const data = (await res.json()) as unknown;
  const json = extractJson(contentOf(provider, data));
  if (!json) throw new Error("no json in llm response");
  const parsed = parse(JSON.parse(json) as unknown);
  if (parsed === null) throw new Error("invalid llm payload");
  return parsed;
}
