import { afterEach, describe, expect, it } from "bun:test";
import { bold, dim, levelColor, renderVerdict, renderVerdictLine } from "../src/cli/render.js";
import type { Verdict } from "../src/types.js";

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    package: "demo@1.0.0",
    risk_score: 2,
    level: "LOW",
    flags: [],
    evidence: [],
    explanation: "fine",
    recommendation: "allow",
    cached: false,
    engine_version: "0.1.0",
    ...overrides,
  };
}

const originalIsTTY = process.stdout.isTTY;
afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

describe("renderVerdict", () => {
  it("renders evidence bullets, verdict and recommendation", () => {
    const out = renderVerdict(
      verdict({
        level: "MEDIUM",
        evidence: ["postinstall added"],
        recommendation: "confirm_with_human",
      }),
    );
    expect(out).toContain("MEDIUM RISK");
    expect(out).toContain("postinstall added");
    expect(out).toContain("confirm with human");
  });

  it("marks cached verdicts and HIGH blocks", () => {
    const out = renderVerdict(verdict({ level: "HIGH", cached: true, recommendation: "block" }));
    expect(out).toContain("(cached)");
    expect(out).toContain("blocked by default");
  });

  it("emits ANSI colors only on a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(renderVerdict(verdict({ level: "HIGH" }))).toContain("\x1b[31m");
    expect(bold("x")).toBe("\x1b[1mx\x1b[0m");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(renderVerdict(verdict({ level: "HIGH" }))).not.toContain("\x1b[");
    expect(dim("x")).toBe("x");
  });
});

describe("renderVerdictLine / levelColor", () => {
  it("lists flags or a placeholder", () => {
    expect(renderVerdictLine(verdict({ flags: ["typosquat"] }))).toContain("typosquat");
    expect(renderVerdictLine(verdict())).toContain("no signals");
  });

  it("colors by level on a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(levelColor("HIGH", "s")).toContain("31m");
    expect(levelColor("MEDIUM", "s")).toContain("33m");
    expect(levelColor("LOW", "s")).toContain("32m");
  });
});
