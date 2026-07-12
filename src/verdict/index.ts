import type { HeuristicResult } from "../heuristics/index.js";
import type { Recommendation } from "../types.js";

const llmModel = () => process.env.WARDEN_LLM_MODEL ?? "claude-haiku-4-5";
const llmBase = () => process.env.WARDEN_LLM_BASE ?? "https://api.anthropic.com";

export const llmStats = { calls: 0 };

export interface VerdictExplanation {
  explanation: string;
  recommendation: Recommendation;
  llm_used: boolean;
}

export interface VerdictInput {
  package: string;
  score: number;
  level: HeuristicResult["level"];
  flags: string[];
  evidence: string[];
}

export interface VerdictProvider {
  explain(input: VerdictInput): Promise<VerdictExplanation>;
}

const REC_RANK: Record<Recommendation, number> = {
  allow: 0,
  confirm_with_human: 1,
  block: 2,
};

function recommendationFor(level: HeuristicResult["level"]): Recommendation {
  if (level === "HIGH") return "block";
  if (level === "MEDIUM") return "confirm_with_human";
  return "allow";
}

export const templateProvider: VerdictProvider = {
  async explain(input: VerdictInput): Promise<VerdictExplanation> {
    const rec = recommendationFor(input.level);
    let explanation: string;
    if (input.level === "LOW") {
      explanation = `No supply-chain risk signals of concern for ${input.package}.`;
    } else {
      const top = input.evidence.slice(0, 3).join("; ");
      const verb = input.level === "HIGH" ? "should be blocked" : "warrants a human check";
      explanation = `${input.package} ${verb}: ${top}.`;
    }
    return { explanation, recommendation: rec, llm_used: false };
  },
};

export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

const VALID_RECS: Recommendation[] = ["allow", "confirm_with_human", "block"];

function buildPrompt(input: VerdictInput): string {
  return [
    "You are a supply-chain security assistant. Based ONLY on the signals",
    "below, decide a verdict for a developer or coding agent installing this",
    "npm package. Do not invent details beyond the evidence.",
    "",
    "Reply with ONLY a JSON object, no prose, of the form:",
    '{"explanation": "<one or two plain-English sentences>",',
    ' "recommendation": "allow" | "confirm_with_human" | "block"}',
    "",
    JSON.stringify(
      {
        package: input.package,
        risk_score: input.score,
        level: input.level,
        flags: input.flags,
        evidence: input.evidence,
      },
      null,
      2,
    ),
  ].join("\n");
}

export class AnthropicVerdictProvider implements VerdictProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async explain(input: VerdictInput): Promise<VerdictExplanation> {
    const floor = recommendationFor(input.level);
    try {
      llmStats.calls += 1;
      const res = await fetch(`${llmBase()}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: llmModel(),
          max_tokens: 512,
          messages: [{ role: "user", content: buildPrompt(input) }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`anthropic -> ${res.status}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((b) => b.type === "text")?.text;
      if (!text) throw new Error("no text block in response");
      const json = extractJsonObject(text);
      if (!json) throw new Error("no JSON object in response");
      const parsed = JSON.parse(json) as { explanation?: unknown; recommendation?: unknown };
      const explanation =
        typeof parsed.explanation === "string" && parsed.explanation.trim()
          ? parsed.explanation.trim()
          : undefined;
      if (!explanation) throw new Error("missing explanation");
      const modelRec = VALID_RECS.includes(parsed.recommendation as Recommendation)
        ? (parsed.recommendation as Recommendation)
        : floor;
      const recommendation = REC_RANK[modelRec] >= REC_RANK[floor] ? modelRec : floor;
      return { explanation, recommendation, llm_used: true };
    } catch {
      return templateProvider.explain(input);
    }
  }
}

export function selectProvider(level: HeuristicResult["level"]): VerdictProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  const shouldEscalate = level === "MEDIUM" || level === "HIGH";
  if (key && shouldEscalate) return new AnthropicVerdictProvider(key);
  return templateProvider;
}
