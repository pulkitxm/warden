import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FixturePackage, pkgJson } from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { CATEGORIES, type Evidence, VERDICT_JSON_SCHEMA, type Verdict } from "../../src/schema.ts";

const warningFixture: FixturePackage = {
  name: "provenance-only",
  downloads: 500_000,
  latest: "1.1.0",
  versions: {
    "1.0.0": {
      files: [
        pkgJson("provenance-only", "1.0.0"),
        { path: "index.js", content: "module.exports={stable:true};" },
      ],
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: true,
      ageHours: 9000,
    },
    "1.1.0": {
      files: [
        pkgJson("provenance-only", "1.1.0"),
        { path: "index.js", content: "module.exports={stable:true};" },
      ],
      maintainer: { name: "steady", email: "steady@example.test" },
      provenance: false,
      ageHours: 720,
    },
  },
};

const repoRoot = join(import.meta.dir, "../..");
let root: string;
let home: string;
let registry: MiniRegistry;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "warden-cli-e2e-"));
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
  registry = startMiniRegistry(0, { fixtures: [warningFixture] });
});

afterAll(() => {
  registry.stop();
  rmSync(root, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  const process = Bun.spawn(["bun", "src/bin/warden.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...Bun.env,
      HOME: home,
      WNPM_CACHE: join(root, "verdicts.sqlite"),
      WNPM_REGISTRY: registry.url,
      WNPM_DOWNLOADS: registry.downloadsUrl,
      OPENAI_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function expectEvidenceShape(evidence: Evidence) {
  expect(typeof evidence.file).toBe("string");
  expect(typeof evidence.detail).toBe("string");
  if (evidence.line !== undefined) expect(Number.isInteger(evidence.line)).toBe(true);
  expect(Object.keys(evidence).every((key) => ["file", "line", "detail"].includes(key))).toBe(true);
}

function expectVerdictShape(value: Verdict) {
  expect(Object.keys(value).sort()).toEqual([...VERDICT_JSON_SCHEMA.required].sort());
  expect(value.schema_version).toBe(VERDICT_JSON_SCHEMA.properties.schema_version.const);
  expect(typeof value.package).toBe("string");
  expect(typeof value.version).toBe("string");
  expect(typeof value.integrity).toBe("string");
  expect(VERDICT_JSON_SCHEMA.properties.verdict.enum).toContain(value.verdict);
  expect(Number.isInteger(value.risk_score)).toBe(true);
  expect(value.risk_score).toBeGreaterThanOrEqual(0);
  expect(value.risk_score).toBeLessThanOrEqual(100);
  expect(value.categories.every((category) => CATEGORIES.includes(category))).toBe(true);
  expect(typeof value.summary).toBe("string");
  expect(Array.isArray(value.evidence)).toBe(true);
  for (const evidence of value.evidence) expectEvidenceShape(evidence);
  expect(typeof value.analyzer_version).toBe("string");
  expect(VERDICT_JSON_SCHEMA.properties.source.enum).toContain(value.source);
}

test("actual warden check returns schema-valid allow, warn, and block verdicts", async () => {
  const allowed = await runCli(["check", "left-pad", "--json"]);
  expect(allowed.exitCode).toBe(0);
  expect(allowed.stderr).toBe("");
  const allowedVerdict = JSON.parse(allowed.stdout) as Verdict;
  expectVerdictShape(allowedVerdict);
  expect(allowedVerdict.verdict).toBe("allow");

  const warned = await runCli(["check", "provenance-only@1.1.0", "--json"]);
  expect(warned.exitCode).toBe(10);
  expect(warned.stderr).toBe("");
  const warnedVerdict = JSON.parse(warned.stdout) as Verdict;
  expectVerdictShape(warnedVerdict);
  expect(warnedVerdict.verdict).toBe("warn");
  expect(warnedVerdict.categories).toContain("provenance_downgrade");

  const blocked = await runCli(["check", "chalk@5.6.1", "--json"]);
  expect(blocked.exitCode).toBe(20);
  expect(blocked.stderr).toBe("");
  const blockedVerdict = JSON.parse(blocked.stdout) as Verdict;
  expectVerdictShape(blockedVerdict);
  expect(blockedVerdict).toMatchObject({ verdict: "block", source: "blocklist" });
});

test("actual warden allow-risky lowers a block exit to warning", async () => {
  const result = await runCli(["check", "chalk@5.6.1", "--json", "--allow-risky"]);
  expect(result.exitCode).toBe(10);
  const verdict = JSON.parse(result.stdout) as Verdict;
  expectVerdictShape(verdict);
  expect(verdict.verdict).toBe("block");
});

test("actual warden reports exact-version analysis errors with exit 30", async () => {
  const result = await runCli(["check", "left-pad@9.9.9", "--json"]);
  expect(result.exitCode).toBe(30);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).error).toMatchObject({
    kind: "analysis",
    code: "WARDEN_ANALYSIS_ERROR",
  });
  expect(JSON.parse(result.stdout).error.reason).toContain("not found");
});

test("actual warden config persists a get and set round-trip in the temporary home", async () => {
  const initial = await runCli(["config", "--json"]);
  expect(initial.exitCode).toBe(0);
  expect(JSON.parse(initial.stdout)).toEqual({
    mode: "brief",
    intercept: { install: true, exec: true },
  });

  expect((await runCli(["config", "intercept", "exec", "off"])).exitCode).toBe(0);
  expect((await runCli(["config", "mode", "log"])).exitCode).toBe(0);

  const updated = await runCli(["config", "--json"]);
  expect(updated.exitCode).toBe(0);
  expect(JSON.parse(updated.stdout)).toEqual({
    mode: "log",
    intercept: { install: true, exec: false },
  });
});

test("actual warden log tails recorded verdict JSON in order", async () => {
  const allowed = JSON.parse((await runCli(["check", "left-pad", "--json"])).stdout) as Verdict;
  const warned = JSON.parse(
    (await runCli(["check", "provenance-only@1.1.0", "--json"])).stdout,
  ) as Verdict;
  const blocked = JSON.parse((await runCli(["check", "chalk@5.6.1", "--json"])).stdout) as Verdict;
  const logDir = join(home, ".warden");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, "log.jsonl"),
    `${[allowed, warned, blocked]
      .map((verdict, index) =>
        JSON.stringify({ timestamp: `2026-07-14T00:00:0${index}Z`, ...verdict }),
      )
      .join("\n")}\n`,
  );

  const result = await runCli(["log", "--tail", "2", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const entries = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Verdict);
  expect(entries.map((entry) => entry.package)).toEqual(["provenance-only", "chalk"]);
  expect(entries.map((entry) => entry.verdict)).toEqual(["warn", "block"]);
});
