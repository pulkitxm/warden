import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { type FixturePackage, pkgJson } from "../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../fixtures/registry/server.ts";
import { VerdictCache } from "../src/cache.ts";
import { runDoctor } from "../src/doctor/index.ts";
import type { ProjectFs } from "../src/doctor/project.ts";
import { checkPackage } from "../src/engine.ts";

const minifiedLine = `module.exports=function(){${"var a0=1;a0+=1;".repeat(200)}return a0};`;

const TRUSTED: FixturePackage[] = [
  {
    name: "chalk",
    downloads: 300_000_000,
    latest: "5.6.2",
    versions: {
      "5.6.1": {
        files: [pkgJson("chalk", "5.6.1"), { path: "index.js", content: "module.exports=s=>s;" }],
        maintainer: { name: "qix", email: "qix@example.com" },
        provenance: true,
        ageHours: 400,
      },
      "5.6.2": {
        files: [pkgJson("chalk", "5.6.2"), { path: "index.js", content: "module.exports=s=>s;" }],
        maintainer: { name: "qix", email: "qix@example.com" },
        provenance: true,
        ageHours: 2,
      },
    },
  },
  {
    name: "acme-native",
    downloads: 5_000_000,
    latest: "1.5.0",
    versions: {
      "1.4.0": {
        files: [
          pkgJson("acme-native", "1.4.0", { postinstall: "node-gyp rebuild" }),
          {
            path: "binding.js",
            content:
              "const cp=require('child_process');module.exports=function(){return cp.execSync('node-gyp rebuild').toString();};",
          },
        ],
        scripts: { postinstall: "node-gyp rebuild" },
        maintainer: { name: "native-team", email: "team@native.dev" },
        provenance: true,
        ageHours: 4320,
      },
      "1.5.0": {
        files: [
          pkgJson("acme-native", "1.5.0", { postinstall: "node-gyp rebuild" }),
          {
            path: "binding.js",
            content:
              "const cp=require('child_process');module.exports=function(){return cp.execSync('node-gyp rebuild').toString();};",
          },
        ],
        scripts: { postinstall: "node-gyp rebuild" },
        maintainer: { name: "native-team", email: "team@native.dev" },
        provenance: true,
        ageHours: 24,
      },
    },
  },
  {
    name: "acme-imaging",
    downloads: 8_000_000,
    latest: "3.1.0",
    versions: {
      "3.0.0": {
        files: [
          pkgJson("acme-imaging", "3.0.0"),
          { path: "index.js", content: "module.exports={resize(){}};" },
        ],
        maintainer: { name: "imaging-team", email: "team@imaging.dev" },
        provenance: true,
        ageHours: 4320,
      },
      "3.1.0": {
        files: [
          pkgJson("acme-imaging", "3.1.0", { postinstall: "node install.js" }),
          { path: "index.js", content: "module.exports={resize(){}};" },
          {
            path: "install.js",
            content:
              "const fs=require('fs');const os=require('os');module.exports=fs.readFileSync(os.homedir()+'/.npmrc','utf8');",
          },
        ],
        scripts: { postinstall: "node install.js" },
        maintainer: { name: "imaging-team", email: "team@imaging.dev" },
        provenance: true,
        ageHours: 12,
      },
    },
  },
  {
    name: "chai",
    downloads: 15_000_000,
    latest: "4.5.0",
    versions: {
      "4.5.0": {
        files: [
          pkgJson("chai", "4.5.0"),
          { path: "index.js", content: "module.exports={expect(){},assert(){}};" },
        ],
        maintainer: { name: "chaijs", email: "team@chaijs.dev" },
        provenance: true,
        ageHours: 8760,
      },
    },
  },
  {
    name: "acme-client",
    downloads: 800,
    latest: "0.3.0",
    versions: {
      "0.3.0": {
        files: [
          pkgJson("acme-client", "0.3.0"),
          {
            path: "index.js",
            content:
              'const https=require("https");const proxy=process.env.HTTPS_PROXY||"";const LOCAL=["127.0.0.1","10.0.0.5","192.168.0.1","169.254.0.1"];module.exports={proxy,LOCAL,request:(u)=>https.get(u),token:(t)=>Buffer.from(t,"utf8")};',
          },
        ],
        maintainer: { name: "clientdev", email: "dev@client.dev" },
        ageHours: 48,
      },
    },
  },
  {
    name: "@acme/config-loader",
    downloads: 12,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("@acme/config-loader", "1.0.0"),
          {
            path: "index.js",
            content: "module.exports=function(path){return JSON.parse(String(path));};",
          },
        ],
        maintainer: { name: "acme-dev", email: "dev@acme.dev" },
        ageHours: 3,
      },
    },
  },
  {
    name: "acme-fresh-tool",
    downloads: 3,
    latest: "0.0.1",
    versions: {
      "0.0.1": {
        files: [
          pkgJson("acme-fresh-tool", "0.0.1"),
          { path: "index.js", content: "module.exports=()=>42;" },
        ],
        maintainer: { name: "newauthor", email: "new@author.dev" },
        ageHours: 1,
      },
    },
  },
  {
    name: "acme-bundled",
    downloads: 900,
    latest: "2.0.0",
    versions: {
      "2.0.0": {
        files: [pkgJson("acme-bundled", "2.0.0"), { path: "dist.js", content: minifiedLine }],
        maintainer: { name: "bundler", email: "bundler@acme.dev" },
        ageHours: 5,
      },
    },
  },
  {
    name: "acme-dns",
    downloads: 3_000_000,
    latest: "1.2.0",
    versions: {
      "1.2.0": {
        files: [
          pkgJson("acme-dns", "1.2.0"),
          {
            path: "index.js",
            content: 'module.exports={servers:["8.8.8.8","1.1.1.1"],lookup(){}};',
          },
        ],
        maintainer: { name: "dns-team", email: "team@dns.dev" },
        provenance: true,
        ageHours: 4320,
      },
    },
  },
];

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry(0, { fixtures: TRUSTED });
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  process.env.WNPM_OSV = reg.url;
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => {
  reg.stop();
  delete process.env.WNPM_OSV;
});

const check = (spec: string) => checkPackage(spec, { cache: new VerdictCache(":memory:") });

test("clean release published hours after a compromised sibling version is allowed", async () => {
  const v = await check("chalk");
  expect(v.version).toBe("5.6.2");
  expect(v.verdict).toBe("allow");
});

test("the compromised sibling itself still hard-blocks from the blocklist", async () => {
  const v = await check("chalk@5.6.1");
  expect(v.verdict).toBe("block");
  expect(v.source).toBe("blocklist");
});

test("established native package with a longstanding postinstall is allowed", async () => {
  const v = await check("acme-native@1.5.0");
  expect(v.verdict).toBe("allow");
});

test("established package adding an install script with a sensitive read warns but never blocks", async () => {
  const v = await check("acme-imaging@3.1.0");
  expect(v.verdict).toBe("warn");
  expect(v.categories).toContain("install_script");
});

test("trusted package two edits from a mega-popular name is not a typosquat", async () => {
  const v = await check("chai");
  expect(v.verdict).toBe("allow");
  expect(v.categories).not.toContain("typosquat");
});

test("tiny new HTTP client reading env and private IPs is allowed", async () => {
  const v = await check("acme-client");
  expect(v.verdict).toBe("allow");
  expect(v.categories).not.toContain("exfiltration");
});

test("brand-new scoped package with a handful of downloads is allowed", async () => {
  const v = await check("@acme/config-loader");
  expect(v.verdict).toBe("allow");
});

test("hour-old unscoped package with three downloads and clean code is allowed", async () => {
  const v = await check("acme-fresh-tool");
  expect(v.verdict).toBe("allow");
  expect(v.risk_score).toBe(0);
});

test("minified-but-clean new package is not treated as obfuscated", async () => {
  const v = await check("acme-bundled");
  expect(v.verdict).toBe("allow");
  expect(v.categories).not.toContain("obfuscation");
});

test("established DNS library shipping public resolver IPs warns at most, never blocks", async () => {
  const v = await check("acme-dns");
  expect(v.verdict).toBe("warn");
  expect(v.verdict).not.toBe("block");
});

function memFs(files: Record<string, string>): ProjectFs {
  return {
    readFile: (path) => {
      const hit = files[path];
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    },
    exists: (path) => files[path] !== undefined,
  };
}

test("doctor reports zero issues for a fully patched healthy project", async () => {
  const fs = memFs({
    [join("/patched", "package.json")]: JSON.stringify({
      name: "patched-demo",
      dependencies: { chalk: "^5.6.2", "acme-json": "^2.1.4", "left-pad": "^1.3.0" },
    }),
    [join("/patched", "node_modules", "chalk", "package.json")]: JSON.stringify({
      version: "5.6.2",
    }),
    [join("/patched", "node_modules", "acme-json", "package.json")]: JSON.stringify({
      version: "2.1.4",
    }),
    [join("/patched", "node_modules", "left-pad", "package.json")]: JSON.stringify({
      version: "1.3.0",
    }),
  });
  const report = await runDoctor("/patched", { verify: false }, { fs, check });
  expect(report.issues).toEqual([]);
  expect(report.plans).toEqual([]);
  expect(report.unfixable).toEqual([]);
  expect(report.notes).toEqual([]);
});

test("doctor plans the clean sibling for a compromised install instead of condemning the package", async () => {
  const fs = memFs({
    [join("/hit", "package.json")]: JSON.stringify({
      name: "hit-demo",
      dependencies: { chalk: "^5.6.1" },
    }),
    [join("/hit", "node_modules", "chalk", "package.json")]: JSON.stringify({ version: "5.6.1" }),
  });
  const report = await runDoctor("/hit", { verify: false }, { fs, check });
  expect(report.issues.map((i) => [i.name, i.kind])).toEqual([["chalk", "compromised"]]);
  expect(report.unfixable).toEqual([]);
  expect(report.plans[0]?.changes).toEqual([
    { name: "chalk", from: "5.6.1", to: "5.6.2", inRange: true, level: "patch" },
  ]);
  const gate = Object.fromEntries(report.gate.map((g) => [`${g.name}@${g.version}`, g.verdict]));
  expect(gate["chalk@5.6.2"]).toBe("allow");
});
