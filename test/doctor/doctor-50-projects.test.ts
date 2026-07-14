import { expect, test } from "bun:test";
import { join } from "node:path";
import { type FixtureVuln, osvRecord } from "../../fixtures/registry/fixtures.ts";
import type { DoctorDeps } from "../../src/doctor/index.ts";
import { runDoctor } from "../../src/doctor/index.ts";
import type { ProjectFs } from "../../src/doctor/project.ts";
import type { VerifyDeps } from "../../src/doctor/verify.ts";
import type { PackageMeta } from "../../src/registry.ts";
import { SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";
import type { OsvVuln } from "../../src/vuln.ts";

type IssueKind = "vulnerability" | "compromised" | "deprecated";

interface TestCase {
  name: string;
  description: string;
  deps: Record<string, string>;
  devDeps?: Record<string, string>;
  installed?: Record<string, string>;
  meta?: Record<string, PackageMeta>;
  vulns?: FixtureVuln[];
  gateBlocks?: string[];
  expectIssues?: IssueKind[];
  expectUnfixable?: string[];
  expectFix?: Record<string, string>;
}

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

function meta(name: string, versions: string[], over: Partial<PackageMeta> = {}): PackageMeta {
  return {
    name,
    version: versions[versions.length - 1] ?? "0.0.0",
    existsOnRegistry: true,
    versions,
    maintainers: ["test-maintainer"],
    ...over,
  };
}

function verdictFor(spec: string, level: Verdict["verdict"]): Verdict {
  const at = spec.lastIndexOf("@");
  return {
    schema_version: SCHEMA_VERSION,
    package: spec.slice(0, at),
    version: spec.slice(at + 1),
    integrity: "",
    verdict: level,
    risk_score: level === "block" ? 90 : 0,
    categories: level === "block" ? ["install_script", "exfiltration"] : [],
    summary:
      level === "block"
        ? `${spec} should not be installed: malicious install script with network exfiltration`
        : `No supply-chain risk signals of concern for ${spec}.`,
    evidence: [],
    analyzer_version: "0.1.0",
    source: "heuristics",
  };
}

const tc = (t: TestCase) => t;

const CLEAN_CASES: TestCase[] = [
  tc({
    name: "proj-01",
    description: "single clean utility",
    deps: { "safe-utils": "^1.0.0" },
    installed: { "safe-utils": "1.0.0" },
    meta: { "safe-utils": meta("safe-utils", ["1.0.0", "1.1.0"]) },
  }),
  tc({
    name: "proj-02",
    description: "multiple clean prod deps",
    deps: { "pure-fn": "^2.0.0", "zen-helpers": "^3.1.0", "quick-parse": "^1.0.0" },
    installed: { "pure-fn": "2.0.1", "zen-helpers": "3.1.2", "quick-parse": "1.0.0" },
    meta: {
      "pure-fn": meta("pure-fn", ["2.0.0", "2.0.1"]),
      "zen-helpers": meta("zen-helpers", ["3.1.0", "3.1.2"]),
      "quick-parse": meta("quick-parse", ["1.0.0"]),
    },
  }),
  tc({
    name: "proj-03",
    description: "clean prod plus clean dev deps",
    deps: { "nano-each": "^1.0.0" },
    devDeps: { "micro-map": "^2.0.0" },
    installed: { "nano-each": "1.0.0", "micro-map": "2.0.0" },
    meta: {
      "nano-each": meta("nano-each", ["1.0.0"]),
      "micro-map": meta("micro-map", ["2.0.0", "2.1.0"]),
    },
  }),
  tc({
    name: "proj-04",
    description: "clean package with high download count",
    deps: { "flash-sort": "^3.0.0" },
    installed: { "flash-sort": "3.0.5" },
    meta: { "flash-sort": meta("flash-sort", ["3.0.0", "3.0.5"], { weeklyDownloads: 5_000_000 }) },
  }),
  tc({
    name: "proj-05",
    description: "clean scoped package",
    deps: { "@scope/clean-lib": "^1.0.0" },
    installed: { "@scope/clean-lib": "1.0.0" },
    meta: { "@scope/clean-lib": meta("@scope/clean-lib", ["1.0.0"]) },
  }),
  tc({
    name: "proj-06",
    description: "clean package with build scripts but no lifecycle hooks",
    deps: { "bolt-run": "^2.0.0" },
    installed: { "bolt-run": "2.0.0" },
    meta: {
      "bolt-run": meta("bolt-run", ["2.0.0"], {
        scripts: { test: "echo ok", build: "echo built" },
      }),
    },
  }),
  tc({
    name: "proj-07",
    description: "clean package with build provenance",
    deps: { "calm-log": "^1.0.0" },
    installed: { "calm-log": "1.0.0" },
    meta: { "calm-log": meta("calm-log", ["1.0.0"], { hasProvenance: true }) },
  }),
  tc({
    name: "proj-08",
    description: "eight clean dependencies",
    deps: Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((n) => [
        `${n}-lib`,
        "^1.0.0",
      ]),
    ),
    installed: Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((n) => [
        `${n}-lib`,
        "1.0.0",
      ]),
    ),
    meta: Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((n) => [
        `${n}-lib`,
        meta(`${n}-lib`, ["1.0.0"]),
      ]),
    ),
  }),
  tc({
    name: "proj-09",
    description: "clean package with no lockfile and no node_modules",
    deps: { "flying-start": "^1.0.0" },
    meta: { "flying-start": meta("flying-start", ["1.0.0"]) },
  }),
  tc({
    name: "proj-10",
    description: "no dependencies at all",
    deps: {},
  }),
];

const VULNERABLE_CASES: TestCase[] = [
  tc({
    name: "proj-11",
    description: "prototype pollution, patch fix inside the declared range",
    deps: { "old-parser": "^1.0.0" },
    installed: { "old-parser": "1.2.0" },
    meta: { "old-parser": meta("old-parser", ["1.0.0", "1.2.0", "1.3.0"]) },
    vulns: [
      {
        id: "GHSA-OP-0001",
        package: "old-parser",
        summary: "prototype pollution via __proto__",
        severity: "high",
        introduced: "0",
        fixed: "1.3.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "old-parser": "1.3.0" },
  }),
  tc({
    name: "proj-12",
    description: "weak randomness, fix needs a minor bump",
    deps: { "weak-crypto": "^1.0.0" },
    installed: { "weak-crypto": "1.0.3" },
    meta: { "weak-crypto": meta("weak-crypto", ["1.0.0", "1.0.3", "1.1.0"]) },
    vulns: [
      {
        id: "GHSA-WC-0001",
        package: "weak-crypto",
        summary: "weak PRNG predictability",
        severity: "moderate",
        introduced: "1.0.0",
        fixed: "1.1.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "weak-crypto": "1.1.0" },
  }),
  tc({
    name: "proj-13",
    description: "open redirect, only fix is a major bump outside the range",
    deps: { "open-redirect": "^2.0.0" },
    installed: { "open-redirect": "2.5.0" },
    meta: { "open-redirect": meta("open-redirect", ["2.0.0", "2.5.0", "3.0.1"]) },
    vulns: [
      {
        id: "GHSA-OR-0001",
        package: "open-redirect",
        summary: "open redirect vulnerability",
        severity: "high",
        introduced: "2.0.0",
        fixed: "3.0.1",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "open-redirect": "3.0.1" },
  }),
  tc({
    name: "proj-14",
    description: "critical prototype pollution in a merge helper",
    deps: { "flat-merge": "^1.0.0" },
    installed: { "flat-merge": "1.0.5" },
    meta: { "flat-merge": meta("flat-merge", ["1.0.0", "1.0.5", "1.2.1"]) },
    vulns: [
      {
        id: "GHSA-FM-0001",
        package: "flat-merge",
        summary: "prototype pollution in merge",
        severity: "critical",
        introduced: "0",
        fixed: "1.2.1",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "flat-merge": "1.2.1" },
  }),
  tc({
    name: "proj-15",
    description: "ReDoS in a comparison routine",
    deps: { "deep-compare": "^1.0.0" },
    installed: { "deep-compare": "1.0.1" },
    meta: { "deep-compare": meta("deep-compare", ["1.0.0", "1.0.1", "1.0.3"]) },
    vulns: [
      {
        id: "GHSA-DC-0001",
        package: "deep-compare",
        summary: "ReDoS in regex comparison",
        severity: "moderate",
        introduced: "1.0.0",
        fixed: "1.0.3",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "deep-compare": "1.0.3" },
  }),
  tc({
    name: "proj-16",
    description: "path traversal via symlink",
    deps: { "wide-path": "^2.0.0" },
    installed: { "wide-path": "2.0.0" },
    meta: { "wide-path": meta("wide-path", ["2.0.0", "2.1.0"]) },
    vulns: [
      {
        id: "GHSA-WP-0001",
        package: "wide-path",
        summary: "path traversal via symlink",
        severity: "high",
        introduced: "2.0.0",
        fixed: "2.1.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "wide-path": "2.1.0" },
  }),
  tc({
    name: "proj-17",
    description: "eval injection through crafted input",
    deps: { "loose-parse": "^1.0.0" },
    installed: { "loose-parse": "1.1.0" },
    meta: { "loose-parse": meta("loose-parse", ["1.0.0", "1.1.0", "1.3.0"]) },
    vulns: [
      {
        id: "GHSA-LP-0001",
        package: "loose-parse",
        summary: "eval injection via crafted input",
        severity: "critical",
        introduced: "0",
        fixed: "1.3.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "loose-parse": "1.3.0" },
  }),
  tc({
    name: "proj-18",
    description: "null prototype pollution",
    deps: { "null-assign": "^1.0.0" },
    installed: { "null-assign": "1.0.0" },
    meta: { "null-assign": meta("null-assign", ["1.0.0", "1.0.2"]) },
    vulns: [
      {
        id: "GHSA-NA-0001",
        package: "null-assign",
        summary: "null prototype pollution",
        severity: "high",
        introduced: "0",
        fixed: "1.0.2",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "null-assign": "1.0.2" },
  }),
  tc({
    name: "proj-19",
    description: "prototype pollution in a deep clone",
    deps: { "fast-clone": "^1.0.0" },
    installed: { "fast-clone": "1.2.0" },
    meta: { "fast-clone": meta("fast-clone", ["1.0.0", "1.2.0", "1.4.0"]) },
    vulns: [
      {
        id: "GHSA-FC-0001",
        package: "fast-clone",
        summary: "prototype pollution in deep clone",
        severity: "high",
        introduced: "1.0.0",
        fixed: "1.4.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "fast-clone": "1.4.0" },
  }),
  tc({
    name: "proj-20",
    description: "denial of service on large streams",
    deps: { "stream-read": "^2.0.0" },
    installed: { "stream-read": "2.0.0" },
    meta: { "stream-read": meta("stream-read", ["2.0.0", "2.0.1"]) },
    vulns: [
      {
        id: "GHSA-SR-0001",
        package: "stream-read",
        summary: "denial of service via large stream",
        severity: "moderate",
        introduced: "2.0.0",
        fixed: "2.0.1",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "stream-read": "2.0.1" },
  }),
  tc({
    name: "proj-21",
    description: "SSRF via DNS rebinding",
    deps: { "url-fetch": "^1.0.0" },
    installed: { "url-fetch": "1.3.0" },
    meta: { "url-fetch": meta("url-fetch", ["1.0.0", "1.3.0", "1.5.2"]) },
    vulns: [
      {
        id: "GHSA-UF-0001",
        package: "url-fetch",
        summary: "SSRF via DNS rebinding",
        severity: "critical",
        introduced: "1.0.0",
        fixed: "1.5.2",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "url-fetch": "1.5.2" },
  }),
  tc({
    name: "proj-22",
    description: "JWT algorithm confusion bypass",
    deps: { "jwt-check": "^3.0.0" },
    installed: { "jwt-check": "3.0.0" },
    meta: { "jwt-check": meta("jwt-check", ["3.0.0", "3.1.0"]) },
    vulns: [
      {
        id: "GHSA-JW-0001",
        package: "jwt-check",
        summary: "algorithm confusion bypass",
        severity: "critical",
        introduced: "0",
        fixed: "3.1.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "jwt-check": "3.1.0" },
  }),
  tc({
    name: "proj-23",
    description: "arbitrary file read through path traversal",
    deps: { "file-grab": "^1.0.0" },
    installed: { "file-grab": "1.0.5" },
    meta: { "file-grab": meta("file-grab", ["1.0.0", "1.0.5", "1.2.0"]) },
    vulns: [
      {
        id: "GHSA-FG-0001",
        package: "file-grab",
        summary: "path traversal to read arbitrary files",
        severity: "high",
        introduced: "1.0.0",
        fixed: "1.2.0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "file-grab": "1.2.0" },
  }),
  tc({
    name: "proj-24",
    description: "XXE injection during XML parsing",
    deps: { "xml-read": "^2.0.0" },
    installed: { "xml-read": "2.0.0" },
    meta: { "xml-read": meta("xml-read", ["2.0.0", "2.0.4"]) },
    vulns: [
      {
        id: "GHSA-XR-0001",
        package: "xml-read",
        summary: "XXE injection via XML parsing",
        severity: "critical",
        introduced: "0",
        fixed: "2.0.4",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "xml-read": "2.0.4" },
  }),
  tc({
    name: "proj-25",
    description: "SQL injection through unsanitised input",
    deps: { "sql-format": "^1.0.0" },
    installed: { "sql-format": "1.0.0" },
    meta: { "sql-format": meta("sql-format", ["1.0.0", "1.1.1"]) },
    vulns: [
      {
        id: "GHSA-SQ-0001",
        package: "sql-format",
        summary: "SQL injection via unsanitized input",
        severity: "critical",
        introduced: "0",
        fixed: "1.1.1",
      },
    ],
    expectIssues: ["vulnerability"],
    expectFix: { "sql-format": "1.1.1" },
  }),
];

const COMPROMISED_CASES: TestCase[] = [
  tc({
    name: "proj-26",
    description: "sneaky-post POSTs the environment to an external host",
    deps: { "sneaky-post": "^1.0.0" },
    installed: { "sneaky-post": "1.0.0" },
    meta: { "sneaky-post": meta("sneaky-post", ["1.0.0"]) },
    gateBlocks: ["sneaky-post@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["sneaky-post"],
  }),
  tc({
    name: "proj-27",
    description: "hidden-setup pipes a remote script into a shell at preinstall",
    deps: { "hidden-setup": "^2.0.0" },
    installed: { "hidden-setup": "2.0.0" },
    meta: { "hidden-setup": meta("hidden-setup", ["2.0.0"]) },
    gateBlocks: ["hidden-setup@2.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["hidden-setup"],
  }),
  tc({
    name: "proj-28",
    description: "stealth-run decodes and evaluates a base64 payload",
    deps: { "stealth-run": "^1.0.0" },
    installed: { "stealth-run": "1.0.0" },
    meta: { "stealth-run": meta("stealth-run", ["1.0.0"]) },
    gateBlocks: ["stealth-run@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["stealth-run"],
  }),
  tc({
    name: "proj-29",
    description: "env-leak exfiltrates environment variables to a raw IP",
    deps: { "env-leak": "^1.0.0" },
    installed: { "env-leak": "1.0.0" },
    meta: { "env-leak": meta("env-leak", ["1.0.0"]) },
    gateBlocks: ["env-leak@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["env-leak"],
  }),
  tc({
    name: "proj-30",
    description: "data-xfer exfiltrates over DNS",
    deps: { "data-xfer": "^1.0.0" },
    installed: { "data-xfer": "1.0.0" },
    meta: { "data-xfer": meta("data-xfer", ["1.0.0"]) },
    gateBlocks: ["data-xfer@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["data-xfer"],
  }),
  tc({
    name: "proj-31",
    description: "shell-spawn opens a reverse shell",
    deps: { "shell-spawn": "^1.0.0" },
    installed: { "shell-spawn": "1.0.0" },
    meta: { "shell-spawn": meta("shell-spawn", ["1.0.0"]) },
    gateBlocks: ["shell-spawn@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["shell-spawn"],
  }),
  tc({
    name: "proj-32",
    description: "exec-hidden runs a downloaded command at install time",
    deps: { "exec-hidden": "^3.0.0" },
    installed: { "exec-hidden": "3.0.0" },
    meta: { "exec-hidden": meta("exec-hidden", ["3.0.0"]) },
    gateBlocks: ["exec-hidden@3.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["exec-hidden"],
  }),
  tc({
    name: "proj-33",
    description: "back-connect beacons to a command-and-control host",
    deps: { "back-connect": "^1.0.0" },
    installed: { "back-connect": "1.0.0" },
    meta: { "back-connect": meta("back-connect", ["1.0.0"]) },
    gateBlocks: ["back-connect@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["back-connect"],
  }),
  tc({
    name: "proj-34",
    description: "crypto-miner runs a miner from postinstall",
    deps: { "crypto-miner": "^1.0.0" },
    installed: { "crypto-miner": "1.0.0" },
    meta: { "crypto-miner": meta("crypto-miner", ["1.0.0"]) },
    gateBlocks: ["crypto-miner@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["crypto-miner"],
  }),
  tc({
    name: "proj-35",
    description: "key-logger installs a keystroke logger",
    deps: { "key-logger": "^1.0.0" },
    installed: { "key-logger": "1.0.0" },
    meta: { "key-logger": meta("key-logger", ["1.0.0"]) },
    gateBlocks: ["key-logger@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: ["key-logger"],
  }),
  tc({
    name: "proj-35b",
    description: "a compromised install that has a clean newer release is fixable",
    deps: { "hijacked-once": "^1.0.0" },
    installed: { "hijacked-once": "1.0.0" },
    meta: { "hijacked-once": meta("hijacked-once", ["1.0.0", "1.0.1"]) },
    gateBlocks: ["hijacked-once@1.0.0"],
    expectIssues: ["compromised"],
    expectUnfixable: [],
    expectFix: { "hijacked-once": "1.0.1" },
  }),
];

const DEPRECATED_CASES: TestCase[] = [
  tc({
    name: "proj-36",
    description: "deprecated utility",
    deps: { "old-deprecated-lib": "^1.0.0" },
    installed: { "old-deprecated-lib": "1.0.0" },
    meta: { "old-deprecated-lib": meta("old-deprecated-lib", ["1.0.0"], { deprecated: true }) },
    expectIssues: ["deprecated"],
  }),
  tc({
    name: "proj-37",
    description: "sunset utility",
    deps: { "sunset-utils": "^2.0.0" },
    installed: { "sunset-utils": "2.0.0" },
    meta: { "sunset-utils": meta("sunset-utils", ["2.0.0"], { deprecated: true }) },
    expectIssues: ["deprecated"],
  }),
  tc({
    name: "proj-38",
    description: "deprecated parser with no replacement",
    deps: { "legacy-parse": "^1.0.0" },
    installed: { "legacy-parse": "1.0.0" },
    meta: { "legacy-parse": meta("legacy-parse", ["1.0.0"], { deprecated: true }) },
    expectIssues: ["deprecated"],
  }),
  tc({
    name: "proj-39",
    description: "deprecated dev dependency",
    deps: {},
    devDeps: { "retired-helper": "^1.0.0" },
    installed: { "retired-helper": "1.0.0" },
    meta: { "retired-helper": meta("retired-helper", ["1.0.0"], { deprecated: true }) },
    expectIssues: ["deprecated"],
  }),
  tc({
    name: "proj-40",
    description: "deprecated production dependency",
    deps: { "archived-core": "^3.0.0" },
    installed: { "archived-core": "3.0.0" },
    meta: { "archived-core": meta("archived-core", ["3.0.0"], { deprecated: true }) },
    expectIssues: ["deprecated"],
  }),
];

const UNFIXABLE_CASES: TestCase[] = [
  tc({
    name: "proj-41",
    description: "trapped-lib: the only advisory fix is itself gate-blocked",
    deps: { "trapped-lib": "^1.0.0" },
    installed: { "trapped-lib": "1.0.0" },
    meta: { "trapped-lib": meta("trapped-lib", ["1.0.0", "1.1.0"]) },
    vulns: [
      {
        id: "GHSA-TP-0001",
        package: "trapped-lib",
        summary: "prototype pollution",
        severity: "high",
        introduced: "0",
        fixed: "1.1.0",
      },
    ],
    gateBlocks: ["trapped-lib@1.1.0"],
    expectIssues: ["vulnerability"],
    expectUnfixable: ["trapped-lib"],
  }),
  tc({
    name: "proj-42",
    description: "dead-end-pkg: the advisory names no fixed version at all",
    deps: { "dead-end-pkg": "^1.0.0" },
    installed: { "dead-end-pkg": "1.0.0" },
    meta: { "dead-end-pkg": meta("dead-end-pkg", ["1.0.0"]) },
    vulns: [
      {
        id: "GHSA-DE-0001",
        package: "dead-end-pkg",
        summary: "remote code execution",
        severity: "critical",
        introduced: "0",
      },
    ],
    expectIssues: ["vulnerability"],
    expectUnfixable: ["dead-end-pkg"],
  }),
  tc({
    name: "proj-43",
    description: "locked-down: the fix release carries a command-injection install script",
    deps: { "locked-down": "^1.0.0" },
    installed: { "locked-down": "1.0.0" },
    meta: { "locked-down": meta("locked-down", ["1.0.0", "1.1.0"]) },
    vulns: [
      {
        id: "GHSA-LD-0001",
        package: "locked-down",
        summary: "command injection",
        severity: "critical",
        introduced: "0",
        fixed: "1.1.0",
      },
    ],
    gateBlocks: ["locked-down@1.1.0"],
    expectIssues: ["vulnerability"],
    expectUnfixable: ["locked-down"],
  }),
  tc({
    name: "proj-44",
    description: "no-way-out: the advisory fix is a hijacked release",
    deps: { "no-way-out": "^2.0.0" },
    installed: { "no-way-out": "2.0.0" },
    meta: { "no-way-out": meta("no-way-out", ["2.0.0", "2.1.0"]) },
    vulns: [
      {
        id: "GHSA-NW-0001",
        package: "no-way-out",
        summary: "supply chain compromise",
        severity: "critical",
        introduced: "2.0.0",
        fixed: "2.1.0",
      },
    ],
    gateBlocks: ["no-way-out@2.1.0"],
    expectIssues: ["vulnerability"],
    expectUnfixable: ["no-way-out"],
  }),
  tc({
    name: "proj-45",
    description: "stuck-package: every candidate above the installed version is blocked",
    deps: { "stuck-package": "^1.0.0" },
    installed: { "stuck-package": "1.0.0" },
    meta: { "stuck-package": meta("stuck-package", ["1.0.0", "1.0.1", "1.0.2"]) },
    vulns: [
      {
        id: "GHSA-SP-0001",
        package: "stuck-package",
        summary: "XSS via template injection",
        severity: "high",
        introduced: "0",
        fixed: "1.0.1",
      },
    ],
    gateBlocks: ["stuck-package@1.0.1", "stuck-package@1.0.2"],
    expectIssues: ["vulnerability"],
    expectUnfixable: ["stuck-package"],
  }),
];

const MIXED_CASES: TestCase[] = [
  tc({
    name: "proj-46",
    description: "one clean, one vulnerable, one compromised",
    deps: { "safe-utils": "^1.0.0", "old-parser": "^1.0.0", "sneaky-post": "^1.0.0" },
    installed: { "safe-utils": "1.0.0", "old-parser": "1.2.0", "sneaky-post": "1.0.0" },
    meta: {
      "safe-utils": meta("safe-utils", ["1.0.0"]),
      "old-parser": meta("old-parser", ["1.0.0", "1.2.0", "1.3.0"]),
      "sneaky-post": meta("sneaky-post", ["1.0.0"]),
    },
    vulns: [
      {
        id: "GHSA-OP-0001",
        package: "old-parser",
        summary: "prototype pollution",
        severity: "high",
        introduced: "0",
        fixed: "1.3.0",
      },
    ],
    gateBlocks: ["sneaky-post@1.0.0"],
    expectIssues: ["vulnerability", "compromised"],
    expectUnfixable: ["sneaky-post"],
    expectFix: { "old-parser": "1.3.0" },
  }),
  tc({
    name: "proj-47",
    description: "two vulnerable production deps and one deprecated dev dep",
    deps: { "weak-crypto": "^1.0.0", "deep-compare": "^1.0.0" },
    devDeps: { "old-deprecated-lib": "^1.0.0" },
    installed: {
      "weak-crypto": "1.0.3",
      "deep-compare": "1.0.1",
      "old-deprecated-lib": "1.0.0",
    },
    meta: {
      "weak-crypto": meta("weak-crypto", ["1.0.0", "1.0.3", "1.1.0"]),
      "deep-compare": meta("deep-compare", ["1.0.0", "1.0.1", "1.0.3"]),
      "old-deprecated-lib": meta("old-deprecated-lib", ["1.0.0"], { deprecated: true }),
    },
    vulns: [
      {
        id: "GHSA-WC-0001",
        package: "weak-crypto",
        summary: "weak PRNG",
        severity: "moderate",
        introduced: "1.0.0",
        fixed: "1.1.0",
      },
      {
        id: "GHSA-DC-0001",
        package: "deep-compare",
        summary: "ReDoS",
        severity: "moderate",
        introduced: "1.0.0",
        fixed: "1.0.3",
      },
    ],
    expectIssues: ["vulnerability", "vulnerability", "deprecated"],
    expectFix: { "weak-crypto": "1.1.0", "deep-compare": "1.0.3" },
  }),
  tc({
    name: "proj-48",
    description: "one fixable vulnerability alongside one unfixable one",
    deps: { "flat-merge": "^1.0.0", "trapped-lib": "^1.0.0" },
    installed: { "flat-merge": "1.0.5", "trapped-lib": "1.0.0" },
    meta: {
      "flat-merge": meta("flat-merge", ["1.0.0", "1.0.5", "1.2.1"]),
      "trapped-lib": meta("trapped-lib", ["1.0.0", "1.1.0"]),
    },
    vulns: [
      {
        id: "GHSA-FM-0001",
        package: "flat-merge",
        summary: "prototype pollution",
        severity: "critical",
        introduced: "0",
        fixed: "1.2.1",
      },
      {
        id: "GHSA-TP-0001",
        package: "trapped-lib",
        summary: "prototype pollution",
        severity: "high",
        introduced: "0",
        fixed: "1.1.0",
      },
    ],
    gateBlocks: ["trapped-lib@1.1.0"],
    expectIssues: ["vulnerability", "vulnerability"],
    expectUnfixable: ["trapped-lib"],
    expectFix: { "flat-merge": "1.2.1" },
  }),
  tc({
    name: "proj-49",
    description: "one clean dep and two unfixable ones",
    deps: { "safe-utils": "^1.0.0", "dead-end-pkg": "^1.0.0", "no-way-out": "^2.0.0" },
    installed: { "safe-utils": "1.0.0", "dead-end-pkg": "1.0.0", "no-way-out": "2.0.0" },
    meta: {
      "safe-utils": meta("safe-utils", ["1.0.0"]),
      "dead-end-pkg": meta("dead-end-pkg", ["1.0.0"]),
      "no-way-out": meta("no-way-out", ["2.0.0", "2.1.0"]),
    },
    vulns: [
      {
        id: "GHSA-DE-0001",
        package: "dead-end-pkg",
        summary: "remote code execution",
        severity: "critical",
        introduced: "0",
      },
      {
        id: "GHSA-NW-0001",
        package: "no-way-out",
        summary: "supply chain compromise",
        severity: "critical",
        introduced: "2.0.0",
        fixed: "2.1.0",
      },
    ],
    gateBlocks: ["no-way-out@2.1.0"],
    expectIssues: ["vulnerability", "vulnerability"],
    expectUnfixable: ["dead-end-pkg", "no-way-out"],
  }),
  tc({
    name: "proj-50",
    description: "compromised, deprecated, vulnerable, and clean deps together",
    deps: {
      "shell-spawn": "^1.0.0",
      "old-deprecated-lib": "^1.0.0",
      "null-assign": "^1.0.0",
      "safe-utils": "^1.0.0",
    },
    installed: {
      "shell-spawn": "1.0.0",
      "old-deprecated-lib": "1.0.0",
      "null-assign": "1.0.0",
      "safe-utils": "1.0.0",
    },
    meta: {
      "shell-spawn": meta("shell-spawn", ["1.0.0"]),
      "old-deprecated-lib": meta("old-deprecated-lib", ["1.0.0"], { deprecated: true }),
      "null-assign": meta("null-assign", ["1.0.0", "1.0.2"]),
      "safe-utils": meta("safe-utils", ["1.0.0"]),
    },
    vulns: [
      {
        id: "GHSA-NA-0001",
        package: "null-assign",
        summary: "null prototype pollution",
        severity: "high",
        introduced: "0",
        fixed: "1.0.2",
      },
    ],
    gateBlocks: ["shell-spawn@1.0.0"],
    expectIssues: ["compromised", "deprecated", "vulnerability"],
    expectUnfixable: ["shell-spawn"],
    expectFix: { "null-assign": "1.0.2" },
  }),
];

const ALL_CASES: TestCase[] = [
  ...CLEAN_CASES,
  ...VULNERABLE_CASES,
  ...COMPROMISED_CASES,
  ...DEPRECATED_CASES,
  ...UNFIXABLE_CASES,
  ...MIXED_CASES,
];

interface Harness {
  deps: DoctorDeps;
  written: Record<string, string>;
  installs: number;
}

function harness(c: TestCase): Harness {
  const manifest = JSON.stringify({
    name: "test-project",
    dependencies: c.deps,
    ...(c.devDeps ? { devDependencies: c.devDeps } : {}),
  });

  const files: Record<string, string> = { [join("/p", "package.json")]: manifest };
  for (const [name, version] of Object.entries(c.installed ?? {})) {
    files[join("/p", "node_modules", name, "package.json")] = JSON.stringify({ version });
  }

  const metaMap = new Map(Object.entries(c.meta ?? {}));
  const vulnMap = new Map<string, FixtureVuln[]>();
  for (const v of c.vulns ?? []) {
    vulnMap.set(v.package, [...(vulnMap.get(v.package) ?? []), v]);
  }
  const blocked = new Set(c.gateBlocks ?? []);

  const written: Record<string, string> = { ...files };
  let installs = 0;

  const verifier: VerifyDeps = {
    exec: () => {
      installs++;
      return { code: 0 };
    },
    mkWorkspace: () => {
      written[join("/workspace", "package.json")] = written[join("/p", "package.json")] as string;
      return "/workspace";
    },
    rm: () => {},
    readFile: (path) => {
      const hit = written[path];
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    },
    writeFile: (path, content) => {
      written[path] = content;
    },
    which: (cmd) => (cmd === "npm" ? "/usr/bin/npm" : null),
    now: () => 0,
  };

  return {
    written,
    get installs() {
      return installs;
    },
    deps: {
      fs: memFs(files),
      verifier,
      resolve: (name: string): Promise<PackageMeta> =>
        Promise.resolve(metaMap.get(name) ?? meta(name, [], { existsOnRegistry: false })),
      vulns: (name: string): Promise<OsvVuln[] | null> =>
        Promise.resolve((vulnMap.get(name) ?? []).map(osvRecord)),
      check: (spec: string): Promise<Verdict> =>
        Promise.resolve(verdictFor(spec, blocked.has(spec) ? "block" : "allow")),
    },
  };
}

for (const c of ALL_CASES) {
  test(`doctor-50 audit: ${c.name} — ${c.description}`, async () => {
    const { deps } = harness(c);
    const report = await runDoctor("/p", { verify: false, apply: false }, deps);

    expect(report.schema_version).toBe(1);
    expect(report.project).toBe("test-project");

    expect(report.issues.map((i) => i.kind)).toEqual(c.expectIssues ?? []);
    expect(report.unfixable.map((u) => u.name).sort()).toEqual(
      [...(c.expectUnfixable ?? [])].sort(),
    );

    const minimal = report.plans.find((p) => p.id === "minimal");
    const applied = Object.fromEntries((minimal?.changes ?? []).map((ch) => [ch.name, ch.to]));
    expect(applied).toEqual(c.expectFix ?? {});

    for (const change of minimal?.changes ?? []) {
      expect(change.from).toBe(c.installed?.[change.name] as string);
    }
  });
}

const FIXABLE = ALL_CASES.filter((c) => c.expectFix && Object.keys(c.expectFix).length > 0);

for (const c of FIXABLE) {
  test(`doctor-50 apply: ${c.name} — ${c.description}`, async () => {
    const h = harness(c);
    const report = await runDoctor("/p", { verify: false, apply: true }, h.deps);

    expect(report.applied).toBe(true);
    expect(h.installs).toBe(1);

    const manifest = JSON.parse(h.written[join("/p", "package.json")] as string) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const ranges = { ...manifest.dependencies, ...manifest.devDependencies };

    for (const [name, version] of Object.entries(c.expectFix as Record<string, string>)) {
      expect(ranges[name]).toBe(version);
    }

    const untouched = Object.keys({ ...c.deps, ...c.devDeps }).filter(
      (n) => !(n in (c.expectFix as Record<string, string>)),
    );
    for (const name of untouched) {
      expect(ranges[name]).toBe(({ ...c.deps, ...c.devDeps } as Record<string, string>)[name]);
    }
  });
}

test("doctor-50 covers every scenario group", () => {
  expect(ALL_CASES).toHaveLength(51);
  expect(new Set(ALL_CASES.map((c) => c.name)).size).toBe(51);
  expect(FIXABLE.length).toBeGreaterThan(15);
});

test("a fix that fails the project's own verification is never applied", async () => {
  const c = VULNERABLE_CASES[0] as TestCase;
  const h = harness(c);
  const failing: VerifyDeps = { ...h.deps.verifier!, exec: () => ({ code: 1 }) };
  const report = await runDoctor("/p", { apply: true }, { ...h.deps, verifier: failing });

  expect(report.plans.every((p) => p.verification?.passed === false)).toBe(true);
  expect(report.recommended).toBeUndefined();
  expect(report.applied).toBeUndefined();
  expect(JSON.parse(h.written[join("/p", "package.json")] as string)).toEqual({
    name: "test-project",
    dependencies: c.deps,
  });
});
