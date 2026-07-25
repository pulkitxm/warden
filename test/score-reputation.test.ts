import { expect, test } from "bun:test";
import type { Signal } from "../src/schema.ts";
import { score } from "../src/score.ts";

const signal = (over: Partial<Signal> & Pick<Signal, "id" | "category">): Signal => ({
  weight: 20,
  confidence: "high",
  evidence: { file: "-", detail: over.id },
  action: true,
  ...over,
});

const ctx = (established: boolean) => ({
  package: "popular-pkg",
  version: "2.0.0",
  integrity: "sha512-x",
  source: "heuristics" as const,
  established,
});

const verdictFor = (signals: Signal[], established: boolean) =>
  score(signals, ctx(established)).verdict;

const LIFECYCLE = signal({ id: "install-script-added", category: "install_script" });

const SINKS: Array<[string, Signal["category"]]> = [
  ["code-raw_ip", "exfiltration"],
  ["code-metadata_host", "exfiltration"],
  ["code-fs_sensitive", "exfiltration"],
  ["code-destructive_fs", "exfiltration"],
  ["code-dns_egress", "exfiltration"],
  ["code-eval", "obfuscation"],
  ["code-base64", "obfuscation"],
  ["script-raw_ip", "exfiltration"],
  ["script-network", "exfiltration"],
  ["script-shell_exec", "install_script"],
  ["script-eval", "obfuscation"],
];

for (const [id, category] of SINKS) {
  test(`a newly added install script with ${id} blocks even when established`, () => {
    const signals = [LIFECYCLE, signal({ id, category })];
    expect(verdictFor(signals, true)).toBe("block");
    expect(verdictFor(signals, false)).toBe("block");
  });
}

test("a changed install script is treated like an added one", () => {
  const signals = [
    signal({ id: "install-script-changed", category: "install_script" }),
    signal({ id: "code-raw_ip", category: "exfiltration" }),
  ];
  expect(verdictFor(signals, true)).toBe("block");
});

test("the exfiltration shape blocks regardless of reputation", () => {
  const signals = [signal({ id: "exfil-shape", category: "exfiltration" })];
  expect(verdictFor(signals, true)).toBe("block");
  expect(verdictFor(signals, false)).toBe("block");
});

test("a name attack blocks regardless of reputation", () => {
  for (const id of [
    "typosquat",
    "homoglyph-typosquat",
    "nonexistent-package",
    "scoped-impersonation",
  ]) {
    expect(verdictFor([signal({ id, category: "typosquat" })], true)).toBe("block");
  }
});

test("a reverse shell blocks regardless of reputation", () => {
  expect(verdictFor([signal({ id: "code-reverse_shell", category: "exfiltration" })], true)).toBe(
    "block",
  );
});

test("reputation still suppresses obfuscation plus exec, which is the bundler false positive", () => {
  const signals = [
    signal({ id: "obfuscated", category: "obfuscation" }),
    signal({ id: "code-eval", category: "obfuscation" }),
  ];
  expect(verdictFor(signals, true)).not.toBe("block");
  expect(verdictFor(signals, false)).toBe("block");
});

test("a lifecycle script with no sink does not block on its own", () => {
  expect(verdictFor([LIFECYCLE], true)).not.toBe("block");
  expect(verdictFor([LIFECYCLE], false)).not.toBe("block");
});

test("a sink with no lifecycle script does not block on its own", () => {
  const sink = signal({ id: "code-raw_ip", category: "exfiltration" });
  expect(verdictFor([sink], true)).not.toBe("block");
});

test("the blocklist source always blocks, whatever the signals say", () => {
  const verdict = score([], { ...ctx(true), source: "blocklist" });
  expect(verdict.verdict).toBe("block");
  expect(verdict.risk_score).toBeGreaterThanOrEqual(0);
});

test("a clean established package is still allowed", () => {
  expect(verdictFor([], true)).toBe("allow");
});
