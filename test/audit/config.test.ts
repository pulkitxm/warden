import { expect, test } from "bun:test";
import {
  auditConfig,
  auditNpmrcEntry,
  editDistance,
  lookalikeOf,
  type NpmrcEntry,
  parseNpmrc,
} from "../../src/audit/config.ts";
import type { AuditFs } from "../../src/audit/types.ts";

const entry = (key: string, value: string, line = 1): NpmrcEntry => ({ key, value, line });
const rulesFor = (key: string, value: string) =>
  auditNpmrcEntry(entry(key, value), ".npmrc").map((f) => f.rule);

test("the default public registry is clean", () => {
  expect(auditNpmrcEntry(entry("registry", "https://registry.npmjs.org/"), ".npmrc")).toEqual([]);
});

const cases: Array<[string, string, string, string, "warn" | "block"]> = [
  [
    "the npmjs.help phishing host",
    "registry",
    "https://registry.npmjs.help/",
    "config_lookalike_registry",
    "block",
  ],
  [
    "a hyphenated npm lookalike",
    "registry",
    "https://registry.npm-js.org/",
    "config_lookalike_registry",
    "block",
  ],
  [
    "a one-character typo",
    "registry",
    "https://registry.npmjs.orgg/",
    "config_lookalike_registry",
    "block",
  ],
  [
    "a plaintext registry",
    "registry",
    "http://registry.npmjs.org/",
    "config_insecure_registry",
    "block",
  ],
  [
    "an unfamiliar private registry",
    "registry",
    "https://packages.internal.example/",
    "config_custom_registry",
    "warn",
  ],
  [
    "a literal auth token",
    "//registry.npmjs.org/:_authToken",
    "npm_secret",
    "config_plaintext_credential",
    "block",
  ],
  ["a literal password", "_password", "hunter2", "config_plaintext_credential", "block"],
  ["disabled TLS verification", "strict-ssl", "false", "config_tls_verification_disabled", "block"],
  ["scripts forced back on", "ignore-scripts", "false", "config_scripts_forced_on", "warn"],
];

for (const [name, key, value, rule, level] of cases) {
  test(`config audit flags ${name}`, () => {
    const findings = auditNpmrcEntry(entry(key, value), ".npmrc");
    const hit = findings.find((f) => f.rule === rule);
    expect(hit).toBeDefined();
    expect(hit?.level).toBe(level);
    expect(hit?.line).toBe(1);
  });
}

test("an env-substituted token is accepted", () => {
  expect(rulesFor("//registry.npmjs.org/:_authToken", `\${NPM_TOKEN}`)).toEqual([]);
});

test("a scoped registry is audited like the default one", () => {
  expect(rulesFor("@acme:registry", "https://registry.npmjs.help/")).toContain(
    "config_lookalike_registry",
  );
});

test("the evidence never repeats the secret it found", () => {
  const findings = auditNpmrcEntry(entry("_authToken", "npm_superSecretValue"), ".npmrc");
  for (const finding of findings) {
    expect(finding.evidence).not.toContain("npm_superSecretValue");
    expect(finding.fix).not.toContain("npm_superSecretValue");
  }
});

test("lookalikeOf accepts the known registries and rejects impostors", () => {
  expect(lookalikeOf("registry.npmjs.org")).toBeNull();
  expect(lookalikeOf("registry.yarnpkg.com")).toBeNull();
  expect(lookalikeOf("registry.npmjs.help")).toBe("registry.npmjs.org");
  expect(lookalikeOf("registry.yarnpkg.co")).toBe("registry.yarnpkg.com");
  expect(lookalikeOf("packages.internal.example")).toBeNull();
});

test("editDistance measures real edits", () => {
  expect(editDistance("", "abc")).toBe(3);
  expect(editDistance("abc", "")).toBe(3);
  expect(editDistance("abc", "abc")).toBe(0);
  expect(editDistance("kitten", "sitting")).toBe(3);
});

test("parseNpmrc keeps line numbers and drops comments and blanks", () => {
  const entries = parseNpmrc(
    [
      "# a comment",
      "; another",
      "",
      "registry=https://x.example/",
      "strict-ssl = false",
      "novalue",
    ].join("\n"),
  );
  expect(entries).toEqual([
    { key: "registry", value: "https://x.example/", line: 4 },
    { key: "strict-ssl", value: "false", line: 5 },
  ]);
});

function fsWith(files: Record<string, string>): AuditFs {
  return {
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    glob: () => [],
  };
}

test("auditConfig reads the project and home npmrc and labels each", () => {
  const report = auditConfig(
    "/proj",
    "/home/u",
    fsWith({
      "/proj/.npmrc": "registry=https://registry.npmjs.help/",
      "/home/u/.npmrc": "strict-ssl=false",
    }),
  );
  expect(report.scanned).toBe(2);
  expect(report.findings.map((f) => f.file).sort()).toEqual([".npmrc", "~/.npmrc"]);
});

test("no npmrc anywhere is a note, not a finding", () => {
  const report = auditConfig("/proj", "/home/u", fsWith({}));
  expect(report.findings).toEqual([]);
  expect(report.notes[0]).toContain("no .npmrc found");
});

test("an unreadable npmrc becomes a note", () => {
  const report = auditConfig("/proj", "/home/u", {
    exists: () => true,
    readFile: () => {
      throw new Error("EACCES");
    },
    glob: () => [],
  });
  expect(report.notes.join(" ")).toContain("could not be read");
});
