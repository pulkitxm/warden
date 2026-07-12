import { describe, expect, it } from "bun:test";
import { detectObfuscation, entropy } from "../src/heuristics/obfuscation.js";
import type { TarballFile } from "../src/types.js";

const file = (path: string, content?: string, binary = false): TarballFile => ({
  path,
  size: content?.length ?? 0,
  content,
  binary,
});

describe("entropy", () => {
  it("is 0 for empty and single-symbol strings", () => {
    expect(entropy("")).toBe(0);
    expect(entropy("aaaa")).toBe(0);
  });

  it("grows with symbol diversity", () => {
    expect(entropy("abcdefgh")).toBeCloseTo(3, 5);
    expect(entropy("aabb")).toBeCloseTo(1, 5);
  });
});

describe("detectObfuscation", () => {
  it("flags one enormous minified line", () => {
    const r = detectObfuscation([file("bundle.js", `var a=1;${"b=b+1;".repeat(400)}`)]);
    expect(r.score).toBeGreaterThanOrEqual(0.4);
    expect(r.reason).toContain("line of");
    expect(r.path).toBe("bundle.js");
  });

  it("flags very long average lines without one giant line", () => {
    const line = "const x = 1; ".repeat(40);
    const r = detectObfuscation([
      file("avg.js", Array.from({ length: 10 }, () => line).join("\n")),
    ]);
    expect(r.reason).toContain("average line length");
  });

  it("flags large encoded blobs and hex-escape runs", () => {
    const blob = detectObfuscation([file("blob.js", `var p="${"A1b2".repeat(60)}";`)]);
    expect(blob.reason).toContain("encoded blob");
    const hex = detectObfuscation([file("hex.js", `var h="${"\\x41".repeat(25)}";`)]);
    expect(hex.reason).toContain("hex-escape");
  });

  it("flags high-entropy packed content", () => {
    const symbols =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!()[]{};:,.<>?*^%$#~";
    let payload = "";
    for (let i = 0; i < 1200; i++) payload += symbols[(i * 37 + (i % 11) * 13) % symbols.length];
    const r = detectObfuscation([file("packed.js", payload)]);
    expect(r.reason).toContain("high entropy");
  });

  it("ignores non-JS, binary and empty files, and reports the worst offender", () => {
    const heavy = `var _x="${"A1b2".repeat(60)}";${"c=c+1;".repeat(400)}`;
    const r = detectObfuscation([
      file("data.json", "A".repeat(5000)),
      file("bin.node", undefined, true),
      file("empty.js", ""),
      file("mild.js", `var a=1;${"b=b+1;".repeat(400)}`),
      file("worst.js", heavy),
    ]);
    expect(r.path).toBe("worst.js");
  });

  it("scores clean code as 0", () => {
    const r = detectObfuscation([file("clean.js", "export const add = (a, b) => a + b;\n")]);
    expect(r.score).toBe(0);
    expect(r.path).toBeUndefined();
  });

  it("scans jsx/tsx bundles too", () => {
    const r = detectObfuscation([file("payload.tsx", `var a=1;${"b=b+1;".repeat(400)}`)]);
    expect(r.score).toBeGreaterThan(0);
  });
});
