import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type FixturePackage,
  type FixtureVersion,
  pkgJson,
} from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { renderDoctorReport } from "../../src/cli/ui.ts";
import { type DoctorReport, runDoctor } from "../../src/doctor/index.ts";
import { issuesOf } from "../../src/doctor/plan.ts";
import { loadProject, type ProjectFs } from "../../src/doctor/project.ts";
import { checkPackage } from "../../src/engine.ts";

const maintainer = { name: "probe", email: "probe@example.com" };
const clean = (name: string, version: string, ageHours = 2000): FixtureVersion => ({
  files: [pkgJson(name, version), { path: "index.js", content: "module.exports={};" }],
  maintainer,
  provenance: true,
  ageHours,
});

const EXTRA_FIXTURES: FixturePackage[] = [
  {
    name: "@acme/utils",
    downloads: 900_000,
    latest: "1.0.2",
    versions: {
      "1.0.0": clean("@acme/utils", "1.0.0"),
      "1.0.1": clean("@acme/utils", "1.0.1"),
      "1.0.2": clean("@acme/utils", "1.0.2"),
    },
  },
  {
    name: "beta-fix-lib",
    downloads: 500_000,
    latest: "1.0.0",
    versions: {
      "1.0.0": clean("beta-fix-lib", "1.0.0"),
      "1.1.0-beta.1": clean("beta-fix-lib", "1.1.0-beta.1"),
    },
  },
  {
    name: "dev-scan-lib",
    downloads: 400_000,
    latest: "1.0.1",
    versions: {
      "1.0.0": clean("dev-scan-lib", "1.0.0"),
      "1.0.1": clean("dev-scan-lib", "1.0.1"),
    },
  },
];

const EXTRA_VULNS = [
  {
    id: "GHSA-SCOPED-0001",
    package: "@acme/utils",
    summary: "scoped advisory one",
    severity: "high",
    introduced: "0",
    fixed: "1.0.1",
  },
  {
    id: "GHSA-SCOPED-0002",
    package: "@acme/utils",
    summary: "scoped advisory two",
    severity: "moderate",
    introduced: "0",
    fixed: "1.0.2",
  },
  {
    id: "GHSA-BETA-0001",
    package: "beta-fix-lib",
    summary: "fixed only in a prerelease",
    severity: "high",
    introduced: "0",
    fixed: "1.1.0-beta.1",
  },
  {
    id: "GHSA-DEV-0001",
    package: "dev-scan-lib",
    summary: "dev tooling advisory",
    severity: "low",
    introduced: "0",
    fixed: "1.0.1",
  },
];

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry(0, { fixtures: EXTRA_FIXTURES, vulns: EXTRA_VULNS });
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

function project(deps: Record<string, unknown>, extras: Record<string, string> = {}): ProjectFs {
  return memFs({
    [join("/p", "package.json")]: JSON.stringify({ name: "hardening", dependencies: deps }),
    ...extras,
  });
}

const installedAs = (name: string, version: string): Record<string, string> => ({
  [join("/p", "node_modules", name, "package.json")]: JSON.stringify({ version }),
});

test("scoped package with two advisories: the fix must clear both", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ "@acme/utils": "^1.0.0" }, installedAs("@acme/utils", "1.0.0")) },
  );
  expect(report.issues.map((i) => i.id)).toEqual(["GHSA-SCOPED-0001", "GHSA-SCOPED-0002"]);
  expect(report.plans[0]?.changes).toEqual([
    { name: "@acme/utils", from: "1.0.0", to: "1.0.2", inRange: true, level: "patch" },
  ]);
  expect(report.gate.map((g) => `${g.name}@${g.version}=${g.verdict}`)).toEqual([
    "@acme/utils@1.0.2=allow",
  ]);
  expect(report.recommended).toBe("minimal");
});

test("advisory fixed only in a prerelease leaves the package unfixable", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ "beta-fix-lib": "^1.0.0" }) },
  );
  expect(report.issues.map((i) => i.id)).toEqual(["GHSA-BETA-0001"]);
  expect(report.unfixable).toEqual([
    { name: "beta-fix-lib", reason: "no published version fixes the reported issues" },
  ]);
  expect(report.plans).toEqual([]);
});

test("vulnerable dev dependency is reported in the dev group and planned", async () => {
  const fs = memFs({
    [join("/p", "package.json")]: JSON.stringify({
      devDependencies: { "dev-scan-lib": "~1.0.0" },
    }),
    ...installedAs("dev-scan-lib", "1.0.0"),
  });
  const report = await runDoctor("/p", { verify: false }, { check, fs });
  expect(report.issues[0]).toMatchObject({ name: "dev-scan-lib", group: "dev", severity: "low" });
  expect(report.plans[0]?.changes[0]?.to).toBe("1.0.1");
});

test("a blocklisted installed version is reported as compromised", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ chalk: "^5.6.0" }, installedAs("chalk", "5.6.1")) },
  );
  expect(report.issues).toHaveLength(1);
  expect(report.issues[0]).toMatchObject({
    name: "chalk",
    kind: "compromised",
    severity: "critical",
  });
  expect(report.issues[0]?.summary).toContain("known-malware blocklist");
  expect(report.unfixable).toEqual([
    { name: "chalk", reason: "no published version fixes the reported issues" },
  ]);

  const rendered = renderDoctorReport(report);
  expect(rendered).toContain("compromised");
  expect(rendered).toContain("chalk@5.6.1");
});

test("git, tag, workspace, and file ranges are skipped with notes, not crashes", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    {
      check,
      fs: project({
        "git-dep": "github:foo/bar",
        "left-pad": "latest",
        "ws-dep": "workspace:*",
        "file-dep": "file:../x",
      }),
    },
  );
  expect(report.issues).toEqual([]);
  expect(report.notes).toEqual([
    "git-dep: not found on the registry; skipped",
    'left-pad: no installed version matches range "latest"; skipped',
    "ws-dep: not found on the registry; skipped",
    "file-dep: not found on the registry; skipped",
  ]);
});

test("non-string range values are coerced instead of crashing", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ "left-pad": 1 }) },
  );
  expect(report.issues).toEqual([]);
  expect(report.notes).toEqual([]);
});

test("a name duplicated across dependency groups is audited once", async () => {
  const fs = memFs({
    [join("/p", "package.json")]: JSON.stringify({
      dependencies: { "acme-json": "^2.1.0" },
      devDependencies: { "acme-json": "^2.1.0" },
    }),
    ...installedAs("acme-json", "2.1.0"),
  });
  const report = await runDoctor("/p", { verify: false }, { check, fs });
  expect(report.issues).toHaveLength(1);
  expect(report.plans[0]?.changes).toHaveLength(1);
});

test("v1 lockfiles resolve installed versions", async () => {
  const fs = memFs({
    [join("/p", "package.json")]: JSON.stringify({
      dependencies: { "acme-json": "^2.1.0" },
    }),
    [join("/p", "package-lock.json")]: JSON.stringify({
      lockfileVersion: 1,
      dependencies: { "acme-json": { version: "2.1.0" } },
    }),
  });
  const report = await runDoctor("/p", { verify: false }, { check, fs });
  expect(report.issues[0]?.installed).toBe("2.1.0");
});

test("an installed version newer than every release yields a clean report", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ "dev-scan-lib": "^1.0.0" }, installedAs("dev-scan-lib", "9.9.9")) },
  );
  expect(report.issues).toEqual([]);
  expect(report.plans).toEqual([]);
});

test("loadProject raises a readable error for missing or malformed manifests", () => {
  expect(() => loadProject("/p", memFs({}))).toThrow('could not read package.json in "/p"');
  expect(() => loadProject("/p", memFs({ [join("/p", "package.json")]: "{oops" }))).toThrow(
    'could not read package.json in "/p"',
  );
});

test("issuesOf emits a compromised issue from a blocklist hit", () => {
  const issues = issuesOf({
    name: "evil-lib",
    range: "^1.0.0",
    group: "prod",
    installed: "1.0.0",
    versions: ["1.0.0"],
    vulns: [],
    deprecated: false,
    blocklistId: "MAL-TEST-1",
    notes: [],
  });
  expect(issues).toEqual([
    {
      name: "evil-lib",
      group: "prod",
      installed: "1.0.0",
      kind: "compromised",
      id: "MAL-TEST-1",
      severity: "critical",
      summary: "installed version is on the known-malware blocklist (MAL-TEST-1)",
    },
  ]);
});

test("a registry outage degrades to per-dependency notes instead of failing the run", async () => {
  const prev = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  try {
    const report = await runDoctor(
      "/p",
      { verify: false },
      { check, fs: project({ "left-pad": "^1.3.0" }) },
    );
    expect(report.issues).toEqual([]);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain("left-pad: registry lookup failed");
  } finally {
    process.env.WNPM_REGISTRY = prev;
  }
});

test("doctor report JSON round-trips through the public shape", async () => {
  const report = await runDoctor(
    "/p",
    { verify: false },
    { check, fs: project({ "acme-json": "^2.1.0" }, installedAs("acme-json", "2.1.0")) },
  );
  const parsed = JSON.parse(JSON.stringify(report)) as DoctorReport;
  expect(parsed.schema_version).toBe(1);
  expect(parsed.plans[0]?.changes[0]?.to).toBe("2.1.4");
});
