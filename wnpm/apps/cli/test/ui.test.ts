import { test, expect } from "bun:test";
import { renderVerdict, renderLine, bold, dim } from "../src/ui.ts";
import { SCHEMA_VERSION, type Verdict } from "@warden/schema";

// Color depends on TTY/NO_COLOR at load time; strip ANSI so assertions hold either way.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  schema_version: SCHEMA_VERSION,
  package: "demo-pkg",
  version: "1.2.3",
  integrity: "sha512-abc",
  verdict: "allow",
  risk_score: 0,
  categories: [],
  summary: "all clear",
  evidence: [],
  analyzer_version: "0.1.0",
  source: "heuristics",
  ...over,
});

test("bold/dim wrap without altering the text", () => {
  expect(strip(bold("hello"))).toBe("hello");
  expect(strip(dim("hello"))).toBe("hello");
});

test("renderVerdict: block report shows categories, evidence files, and override hint", () => {
  const out = strip(
    renderVerdict(
      verdict({
        verdict: "block",
        risk_score: 87,
        categories: ["exfiltration", "install_script"],
        summary: "steals env vars",
        evidence: [
          { file: "setup.js", detail: "POSTs process.env to a raw IP" },
          { file: "-", detail: "blocklist entry MAL-X" },
        ],
      }),
    ),
  );
  expect(out).toContain("BLOCK");
  expect(out).toContain("demo-pkg@1.2.3");
  expect(out).toContain("risk 87/100");
  expect(out).toContain("categories: exfiltration, install_script");
  expect(out).toContain("POSTs process.env to a raw IP (setup.js)");
  expect(out).toContain("blocklist entry MAL-X");
  expect(out).not.toContain("(-)"); // "-" placeholder files are not printed
  expect(out).toContain("verdict: steals env vars");
  expect(out).toContain("override with --allow-risky");
});

test("renderVerdict: warn report colors the badge, no override hint", () => {
  const out = strip(renderVerdict(verdict({ verdict: "warn", risk_score: 40, categories: ["metadata_anomaly"] })));
  expect(out).toContain("WARN");
  expect(out).not.toContain("--allow-risky");
});

test("renderVerdict: allow report omits the categories line", () => {
  const out = strip(renderVerdict(verdict()));
  expect(out).toContain("ALLOW");
  expect(out).not.toContain("categories:");
});

test("renderLine: one-liner with categories, or 'clean' when none", () => {
  expect(strip(renderLine(verdict({ verdict: "block", categories: ["typosquat"] })))).toContain("BLOCK demo-pkg@1.2.3  typosquat");
  expect(strip(renderLine(verdict()))).toContain("ALLOW demo-pkg@1.2.3  clean");
});
