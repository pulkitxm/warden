/**
 * Stage-2 LLM explanation (OpenAI). Cost-controlled by construction:
 *  - Only called on escalation (warn/block), only when OPENAI_API_KEY is set.
 *  - Fed a compact signal summary, never raw file contents.
 *  - Rewrites ONLY the plain-English summary; it never changes the verdict, so
 *    the deterministic false-positive guarantees hold regardless of the model.
 *  - Any error (no key, network, bad JSON) falls back to a template.
 *
 * Uses fetch directly against the Chat Completions API (no SDK dependency).
 */

import type { Verdict } from "./schema.ts";

const MODEL = process.env.WNPM_LLM_MODEL ?? "gpt-4o-mini";

/** Real LLM calls made this process — surfaced for the cache-hit demo metric. */
export const llmStats = { calls: 0 };

function template(v: Verdict): string {
  if (v.verdict === "allow") return `No supply-chain risk signals of concern for ${v.package}@${v.version}.`;
  const top = v.evidence.slice(0, 3).map((e) => e.detail).join("; ");
  const verb = v.verdict === "block" ? "should not be installed" : "warrants review";
  return `${v.package}@${v.version} ${verb}: ${top}.`;
}

function extractJson(text: string): string | null {
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

/**
 * Return a plain-English summary for a verdict. Escalates to the model only for
 * warn/block verdicts when a key is present; otherwise returns the template.
 */
export async function explain(verdict: Verdict): Promise<{ summary: string; used: boolean }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || verdict.verdict === "allow") return { summary: template(verdict), used: false };

  const compact = {
    package: `${verdict.package}@${verdict.version}`,
    verdict: verdict.verdict,
    risk_score: verdict.risk_score,
    categories: verdict.categories,
    evidence: verdict.evidence.map((e) => e.detail),
  };

  try {
    llmStats.calls += 1;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a supply-chain security analyst. Given detection signals for an npm package, write one or two plain-English sentences explaining the risk to a developer or coding agent. Use only the evidence provided; do not invent details.",
          },
          { role: "user", content: JSON.stringify(compact) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "explanation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary"],
              properties: { summary: { type: "string" } },
            },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const json = extractJson(content);
    if (!json) throw new Error("no json");
    const parsed = JSON.parse(json) as { summary?: unknown };
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) throw new Error("no summary");
    return { summary: parsed.summary.trim(), used: true };
  } catch {
    return { summary: template(verdict), used: false };
  }
}
