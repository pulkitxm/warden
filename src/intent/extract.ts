import { completeJson } from "./llm.ts";
import type { ClaimKind, IntentClaim, IntentLedger } from "./types.ts";

const KINDS = ["behavior", "preservation", "constraint", "structural"];

const SYSTEM = [
  "You decompose an instruction given to a coding agent into atomic, independently",
  "verifiable claims. Each claim states exactly one requirement in at most 20 words.",
  "kind is behavior, preservation, constraint, or structural; use preservation when the",
  "instruction asks to keep or not break something. keywords are 2 to 6 lowercase terms",
  "likely to appear in code symbols implementing the claim. sourceText echoes the exact",
  "phrase of the instruction the claim came from. Never invent requirements that are not",
  "in the instruction.",
].join(" ");

export function claimsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "kind", "keywords", "sourceText"],
          properties: {
            claim: { type: "string" },
            kind: { type: "string", enum: KINDS },
            keywords: { type: "array", items: { type: "string" } },
            sourceText: { type: "string" },
          },
        },
      },
    },
  };
}

export function parseClaims(value: unknown): Omit<IntentClaim, "id">[] | null {
  if (typeof value !== "object" || value === null) return null;
  const claims = (value as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) return null;
  const out: Omit<IntentClaim, "id">[] = [];
  for (const entry of claims) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.claim !== "string" || !record.claim.trim()) return null;
    if (typeof record.kind !== "string" || !KINDS.includes(record.kind)) return null;
    if (!Array.isArray(record.keywords)) return null;
    if (record.keywords.some((keyword) => typeof keyword !== "string")) return null;
    if (typeof record.sourceText !== "string") return null;
    out.push({
      claim: record.claim.trim(),
      kind: record.kind as ClaimKind,
      keywords: record.keywords.map((keyword) => String(keyword).toLowerCase()),
      sourceText: record.sourceText,
    });
  }
  return out;
}

export async function extractClaims(prompt: string): Promise<IntentLedger> {
  const claims = await completeJson(
    { system: SYSTEM, user: prompt, schemaName: "intent_claims", schema: claimsSchema() },
    parseClaims,
  );
  return {
    schema_version: 1,
    source: "prompt",
    source_text: prompt,
    claims: claims.map((claim, index) => ({ ...claim, id: `c${index + 1}` })),
  };
}
