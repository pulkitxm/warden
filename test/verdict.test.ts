import { afterEach, describe, expect, it } from "bun:test";
import {
  AnthropicVerdictProvider,
  extractJsonObject,
  llmStats,
  selectProvider,
  templateProvider,
  type VerdictInput,
} from "../src/verdict/index.js";
import { jsonResponse, stubFetch } from "./helpers/fetchStub.js";

function input(level: VerdictInput["level"]): VerdictInput {
  return {
    package: "demo@1.0.0",
    score: level === "HIGH" ? 8 : level === "MEDIUM" ? 4 : 0,
    level,
    flags: ["new_postinstall"],
    evidence: ["postinstall script added", "network in script", "raw ip", "extra"],
  };
}

function anthropicReply(body: unknown): Response {
  return jsonResponse({ content: [{ type: "text", text: JSON.stringify(body) }] });
}

let restore = () => {};
afterEach(() => restore());

describe("templateProvider", () => {
  const provider = templateProvider;

  it("allows LOW with a clean explanation", async () => {
    const r = await provider.explain(input("LOW"));
    expect(r).toEqual({
      explanation: "No supply-chain risk signals of concern for demo@1.0.0.",
      recommendation: "allow",
      llm_used: false,
    });
  });

  it("asks for confirmation on MEDIUM and blocks on HIGH", async () => {
    const med = await provider.explain(input("MEDIUM"));
    expect(med.recommendation).toBe("confirm_with_human");
    expect(med.explanation).toContain("warrants a human check");
    const high = await provider.explain(input("HIGH"));
    expect(high.recommendation).toBe("block");
    expect(high.explanation).toContain("should be blocked");
  });
});

describe("extractJsonObject", () => {
  it("extracts a balanced object from prose and fences", () => {
    expect(extractJsonObject('```json\n{"a":{"b":1}}\n```')).toBe('{"a":{"b":1}}');
    expect(extractJsonObject('text {"a":"x{y}z"} tail')).toBe('{"a":"x{y}z"}');
    expect(extractJsonObject('{"a":"esc\\"}"}')).toBe('{"a":"esc\\"}"}');
  });

  it("returns undefined without a balanced object", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
    expect(extractJsonObject('{"a":1')).toBeUndefined();
  });
});

describe("AnthropicVerdictProvider", () => {
  it("uses the model explanation and counts the call", async () => {
    restore = stubFetch(() =>
      anthropicReply({ explanation: "Looks hijacked.", recommendation: "block" }),
    );
    const before = llmStats.calls;
    const r = await new AnthropicVerdictProvider("k").explain(input("HIGH"));
    expect(llmStats.calls).toBe(before + 1);
    expect(r).toEqual({ explanation: "Looks hijacked.", recommendation: "block", llm_used: true });
  });

  it("never lets the model downgrade below the deterministic floor", async () => {
    restore = stubFetch(() =>
      anthropicReply({ explanation: "Seems fine actually.", recommendation: "allow" }),
    );
    const r = await new AnthropicVerdictProvider("k").explain(input("HIGH"));
    expect(r.recommendation).toBe("block");
    expect(r.llm_used).toBe(true);
  });

  it("lets the model escalate above the floor", async () => {
    restore = stubFetch(() =>
      anthropicReply({ explanation: "Worse than it looks.", recommendation: "block" }),
    );
    const r = await new AnthropicVerdictProvider("k").explain(input("MEDIUM"));
    expect(r.recommendation).toBe("block");
  });

  it("uses the floor when the model recommendation is invalid", async () => {
    restore = stubFetch(() => anthropicReply({ explanation: "Hm.", recommendation: "maybe" }));
    const r = await new AnthropicVerdictProvider("k").explain(input("MEDIUM"));
    expect(r.recommendation).toBe("confirm_with_human");
  });

  it("falls back to the template on HTTP errors", async () => {
    restore = stubFetch(() => jsonResponse({ error: "overloaded" }, 529));
    const r = await new AnthropicVerdictProvider("k").explain(input("HIGH"));
    expect(r.llm_used).toBe(false);
    expect(r.recommendation).toBe("block");
  });

  it("falls back when the response has no text block", async () => {
    restore = stubFetch(() => jsonResponse({ content: [{ type: "tool_use" }] }));
    const r = await new AnthropicVerdictProvider("k").explain(input("MEDIUM"));
    expect(r.llm_used).toBe(false);
  });

  it("falls back when the text has no JSON object", async () => {
    restore = stubFetch(() => jsonResponse({ content: [{ type: "text", text: "sorry" }] }));
    const r = await new AnthropicVerdictProvider("k").explain(input("MEDIUM"));
    expect(r.llm_used).toBe(false);
  });

  it("falls back when the explanation is missing or blank", async () => {
    restore = stubFetch(() => anthropicReply({ explanation: "  ", recommendation: "block" }));
    const r = await new AnthropicVerdictProvider("k").explain(input("MEDIUM"));
    expect(r.llm_used).toBe(false);
  });

  it("sends the compact signal payload to the configured endpoint", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    restore = stubFetch((u, init) => {
      url = u;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return anthropicReply({ explanation: "ok", recommendation: "block" });
    });
    process.env.WARDEN_LLM_BASE = "https://llm.test";
    process.env.WARDEN_LLM_MODEL = "test-model";
    await new AnthropicVerdictProvider("secret").explain(input("HIGH"));
    delete process.env.WARDEN_LLM_BASE;
    delete process.env.WARDEN_LLM_MODEL;
    expect(url).toBe("https://llm.test/v1/messages");
    expect(body.model).toBe("test-model");
    const content = (body.messages as Array<{ content: string }>)[0]?.content ?? "";
    expect(content).toContain("demo@1.0.0");
    expect(content).not.toContain("raw file");
  });
});

describe("selectProvider", () => {
  it("selects by key presence and escalation level", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(selectProvider("HIGH")).toBe(templateProvider);
    process.env.ANTHROPIC_API_KEY = "k";
    expect(selectProvider("LOW")).toBe(templateProvider);
    expect(selectProvider("MEDIUM")).toBeInstanceOf(AnthropicVerdictProvider);
    expect(selectProvider("HIGH")).toBeInstanceOf(AnthropicVerdictProvider);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
