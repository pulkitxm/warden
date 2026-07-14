export const intentLlmStats = { calls: 0 };

export type ProviderName = "openai" | "groq" | "ollama" | "claude" | "codex";

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

type HttpProviderName = Exclude<ProviderName, "claude" | "codex">;

const PROVIDER_ORDER: HttpProviderName[] = ["openai", "groq", "ollama"];

const PROVIDER_KEYS: Record<HttpProviderName, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const PROVIDER_URLS: Record<HttpProviderName, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  ollama: "https://ollama.com/api/chat",
};

const DEFAULT_MODELS: Record<HttpProviderName, string> = {
  openai: "gpt-4o-mini",
  groq: "openai/gpt-oss-20b",
  ollama: "gpt-oss:20b",
};

export function resolveProvider(env: Record<string, string | undefined>): Provider {
  let name: HttpProviderName;
  if (env.WNPM_LLM_PROVIDER !== undefined) {
    const forced = env.WNPM_LLM_PROVIDER as HttpProviderName;
    if (env.WNPM_LLM_PROVIDER === "claude") {
      return {
        name: "claude",
        key: "",
        url: env.WNPM_CLAUDE_BIN ?? "claude",
        model: env.WNPM_LLM_MODEL ?? "haiku",
      };
    }
    if (env.WNPM_LLM_PROVIDER === "codex") {
      return {
        name: "codex",
        key: "",
        url: env.WNPM_CODEX_BIN ?? "codex",
        model: env.WNPM_LLM_MODEL ?? "",
      };
    }
    if (!PROVIDER_ORDER.includes(forced)) {
      throw new Error(`unknown llm provider "${env.WNPM_LLM_PROVIDER}"`);
    }
    name = forced;
  } else {
    const found = PROVIDER_ORDER.find((candidate) => env[PROVIDER_KEYS[candidate]]);
    if (!found) {
      throw new Error(
        "no llm api key configured (set WNPM_LLM_PROVIDER=claude or codex to use a cli on your subscription, or GROQ_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY)",
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

async function httpText(provider: Provider, request: LlmJsonRequest): Promise<string> {
  const res = await fetch(provider.url, {
    method: "POST",
    headers: { authorization: `Bearer ${provider.key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify(requestBody(provider, request)),
  });
  if (!res.ok) {
    const body = (await res.text()).trim().replace(/\s+/g, " ").slice(0, 200);
    throw new Error(body ? `${provider.name} ${res.status}: ${body}` : `${provider.name} ${res.status}`);
  }
  return contentOf(provider, (await res.json()) as unknown);
}

function cliError(name: string, exitCode: number, stderr: string): string {
  const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 200);
  return detail ? `${name} ${exitCode}: ${detail}` : `${name} ${exitCode}`;
}

async function claudeText(provider: Provider, request: LlmJsonRequest): Promise<string> {
  const prompt = [
    request.system,
    request.user,
    `Respond with ONLY a JSON object matching this schema: ${JSON.stringify(request.schema)}`,
  ].join("\n\n");
  const proc = Bun.spawn([provider.url, "-p", "--model", provider.model], {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
    timeout: 120_000,
  });
  const [text, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(cliError("claude", exitCode, err));
  return text;
}

async function codexText(provider: Provider, request: LlmJsonRequest): Promise<string> {
  const prompt = [
    request.system,
    request.user,
    `Respond with ONLY a JSON object matching this schema: ${JSON.stringify(request.schema)}`,
  ].join("\n\n");
  const args = ["exec", "--sandbox", "read-only"];
  if (provider.model !== "") args.push("--model", provider.model);
  args.push("-");
  const proc = Bun.spawn([provider.url, ...args], {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
    timeout: 120_000,
  });
  const [text, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(cliError("codex", exitCode, err));
  return text;
}

export async function completeJson<T>(
  request: LlmJsonRequest,
  parse: (value: unknown) => T | null,
): Promise<T> {
  const provider = resolveProvider(process.env);
  intentLlmStats.calls += 1;
  const text =
    provider.name === "claude"
      ? await claudeText(provider, request)
      : provider.name === "codex"
        ? await codexText(provider, request)
        : await httpText(provider, request);
  const json = extractJson(text);
  if (!json) throw new Error("no json in llm response");
  const parsed = parse(JSON.parse(json) as unknown);
  if (parsed === null) throw new Error("invalid llm payload");
  return parsed;
}
