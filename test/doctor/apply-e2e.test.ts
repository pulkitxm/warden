import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FixturePackage, pkgJson } from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { defaultDeps, type RunDeps, runWnpm } from "../../src/cli/main.ts";
import type { DoctorReport } from "../../src/doctor/index.ts";
import { checkPackage } from "../../src/engine.ts";
import type { Verdict } from "../../src/schema.ts";

const CHALK_WITH_CLEAN_SIBLING: FixturePackage = {
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
};

let reg: MiniRegistry;
let prevCache: string | undefined;

beforeAll(() => {
  reg = startMiniRegistry(0, { fixtures: [CHALK_WITH_CLEAN_SIBLING] });
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  process.env.WNPM_OSV = reg.url;
  prevCache = process.env.WNPM_CACHE;
  process.env.WNPM_CACHE = ":memory:";
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => {
  reg.stop();
  delete process.env.WNPM_OSV;
  if (prevCache === undefined) delete process.env.WNPM_CACHE;
  else process.env.WNPM_CACHE = prevCache;
});

function project(
  deps: Record<string, string>,
  installed: Record<string, string> = {},
  scripts: Record<string, string> = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "wnpm-e2e-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "e2e-demo", version: "1.0.0", private: true, scripts, dependencies: deps }),
  );
  writeFileSync(join(dir, "bun.lock"), "");
  for (const [name, version] of Object.entries(installed)) {
    mkdirSync(join(dir, "node_modules", name), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  return dir;
}

function manifest(dir: string): Record<string, string> {
  return (
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    }
  ).dependencies;
}

function installedVersionOf(dir: string, name: string): string {
  return (
    JSON.parse(readFileSync(join(dir, "node_modules", name, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function doctor(
  dir: string,
  ...flags: string[]
): Promise<{ code: number; report: DoctorReport }> {
  const proc = Bun.spawn(
    [
      process.execPath,
      join(repoRoot, "src", "bin", "wnpm.ts"),
      "doctor",
      "--dir",
      dir,
      "--json",
      ...flags,
    ],
    { cwd: repoRoot, env: { ...process.env }, stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return { code: proc.exitCode ?? -1, report: JSON.parse(out) as DoctorReport };
}

test("healthy project: no issues, nothing applied, manifest untouched", async () => {
  const dir = project({ "left-pad": "^1.3.0" }, { "left-pad": "1.3.0" });
  const before = readFileSync(join(dir, "package.json"), "utf8");
  const { code, report } = await doctor(dir);
  expect(code).toBe(0);
  expect(report.issues).toEqual([]);
  expect(report.applied).toBeUndefined();
  expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
}, 30000);

test("vulnerable project: doctor finds, verifies with the project's own tests, and fixes on disk", async () => {
  const dir = project(
    { "acme-json": "^2.1.0" },
    { "acme-json": "2.1.0" },
    { test: 'bun -e "require(\'acme-json\')"' },
  );
  const { code, report } = await doctor(dir);
  expect(report.issues.map((i) => [i.name, i.kind, i.fixedIn])).toEqual([
    ["acme-json", "vulnerability", "2.1.4"],
  ]);
  expect(report.plans[0]?.verification?.steps.map((s) => s.name)).toEqual(["install", "test"]);
  expect(report.plans[0]?.verification?.passed).toBe(true);
  expect(report.applied).toBe(true);
  expect(code).toBe(0);
  expect(manifest(dir)["acme-json"]).toBe("2.1.4");
  expect(installedVersionOf(dir, "acme-json")).toBe("2.1.4");

  const again = await doctor(dir);
  expect(again.code).toBe(0);
  expect(again.report.issues).toEqual([]);
  expect(manifest(dir)["acme-json"]).toBe("2.1.4");
}, 60000);

test("mixed project: fixable dep is fixed, unfixable dep is reported and the exit code says so", async () => {
  const dir = project(
    { "acme-http": "^1.0.0", "acme-json": "^2.1.0" },
    { "acme-http": "1.0.0", "acme-json": "2.1.0" },
  );
  const { code, report } = await doctor(dir);
  expect(report.applied).toBe(true);
  expect(report.unfixable).toEqual([
    { name: "acme-http", reason: "every candidate fix was blocked by the supply-chain gate" },
  ]);
  expect(code).toBe(10);
  expect(manifest(dir)["acme-json"]).toBe("2.1.4");
  expect(manifest(dir)["acme-http"]).toBe("^1.0.0");

  const again = await doctor(dir, "--no-apply");
  expect(again.code).toBe(10);
  const acmeHttp = again.report.issues.find((i) => i.name === "acme-http");
  expect(acmeHttp?.kind).toBe("compromised");
  expect(acmeHttp?.installed).toBe("1.0.1");
  expect(acmeHttp?.summary).toContain("failed the supply-chain gate");
}, 60000);

test("compromised install: doctor upgrades to the clean sibling release", async () => {
  const dir = project({ chalk: "^5.6.1" }, { chalk: "5.6.1" });
  const { code, report } = await doctor(dir);
  expect(report.issues.map((i) => [i.name, i.kind])).toEqual([["chalk", "compromised"]]);
  expect(report.applied).toBe(true);
  expect(code).toBe(0);
  expect(manifest(dir).chalk).toBe("5.6.2");
  expect(installedVersionOf(dir, "chalk")).toBe("5.6.2");
}, 60000);

test("--no-apply reports the same findings but leaves the project untouched", async () => {
  const dir = project({ "acme-json": "^2.1.0" }, { "acme-json": "2.1.0" });
  const before = readFileSync(join(dir, "package.json"), "utf8");
  const { code, report } = await doctor(dir, "--no-apply");
  expect(report.issues).toHaveLength(1);
  expect(report.recommended).toBe("minimal");
  expect(report.applied).toBeUndefined();
  expect(code).toBe(10);
  expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
}, 60000);

test("an upgrade that breaks the project's tests is never applied", async () => {
  const dir = project(
    { "acme-json": "^2.1.0" },
    { "acme-json": "2.1.0" },
    { test: 'bun -e "process.exit(1)"' },
  );
  const before = readFileSync(join(dir, "package.json"), "utf8");
  const { code, report } = await doctor(dir);
  expect(report.plans.every((p) => p.verification?.passed === false)).toBe(true);
  expect(report.recommended).toBeUndefined();
  expect(report.applied).toBeUndefined();
  expect(code).toBe(10);
  expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
}, 60000);

test("install path: the wrong package is refused, the right one passes, nothing executes", async () => {
  const dir = project({ lodahs: "^1.0.0", "left-pad": "^1.3.0" });
  const out: string[] = [];
  const spawned: string[][] = [];
  const deps: RunDeps = {
    ...defaultDeps,
    check: (spec) => checkPackage(spec, { cache: new VerdictCache(":memory:") }),
    stdout: (s) => out.push(s),
    stderr: () => undefined,
    readFile: (path) => readFileSync(join(dir, path), "utf8"),
    spawn: (cmd) => {
      spawned.push(cmd);
      return 0;
    },
  };
  const code = await runWnpm(["install", "--json"], deps);
  expect(code).toBe(20);
  expect(spawned).toEqual([]);
  const verdicts = JSON.parse(out.join("")) as Verdict[];
  const byName = Object.fromEntries(verdicts.map((v) => [v.package, v.verdict]));
  expect(byName.lodahs).toBe("block");
  expect(byName["left-pad"]).toBe("allow");
});

test("install path: a clean dependency set is vetted and handed to the package manager", async () => {
  const dir = project({ "left-pad": "^1.3.0" });
  const spawned: string[][] = [];
  const deps: RunDeps = {
    ...defaultDeps,
    check: (spec) => checkPackage(spec, { cache: new VerdictCache(":memory:") }),
    stdout: () => undefined,
    stderr: () => undefined,
    readFile: (path) => readFileSync(join(dir, path), "utf8"),
    spawn: (cmd) => {
      spawned.push(cmd);
      return 0;
    },
  };
  const code = await runWnpm(["install"], deps);
  expect(code).toBe(0);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.[1]).toBe("install");
});
