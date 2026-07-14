import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { osvRecord } from "../../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { type DoctorDeps, runDoctor } from "../../src/doctor/index.ts";
import type { ProjectFs } from "../../src/doctor/project.ts";
import type { VerifyDeps } from "../../src/doctor/verify.ts";
import { checkPackage } from "../../src/engine.ts";
import type { PackageMeta } from "../../src/registry.ts";
import { SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";

const doctorProject = fileURLToPath(new URL("../../fixtures/doctor-project", import.meta.url));

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry();
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  process.env.WNPM_OSV = reg.url;
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => {
  reg.stop();
  delete process.env.WNPM_OSV;
});

const engineCheck = (spec: string) => checkPackage(spec, { cache: new VerdictCache(":memory:") });

interface FakeVerifier {
  deps: VerifyDeps;
  calls: Array<{ cmd: string[]; cwd: string }>;
  written: Record<string, string>;
}

function fakeVerifier(pkgJson: string, exitCode = 0): FakeVerifier {
  const calls: Array<{ cmd: string[]; cwd: string }> = [];
  const written: Record<string, string> = {};
  let tick = 0;
  return {
    calls,
    written,
    deps: {
      exec: (cmd, cwd) => {
        calls.push({ cmd, cwd });
        return { code: exitCode };
      },
      mkWorkspace: () => "/workspace",
      readFile: () => pkgJson,
      writeFile: (path, content) => {
        written[path] = content;
      },
      which: () => null,
      now: () => tick++,
    },
  };
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

const fixturePkgJson = JSON.stringify({
  name: "doctor-demo",
  scripts: { test: "noop" },
  dependencies: { "acme-http": "^1.0.0", "acme-json": "^2.1.0", "left-pad": "^1.3.0" },
});

test("doctor finds advisories, gates candidate fixes, and verifies plans", async () => {
  const verifier = fakeVerifier(fixturePkgJson);
  const report = await runDoctor(
    doctorProject,
    {},
    { check: engineCheck, verifier: verifier.deps },
  );

  expect(report.schema_version).toBe(1);
  expect(report.project).toBe("doctor-demo");
  expect(report.issues.map((i) => [i.name, i.kind, i.severity])).toEqual([
    ["acme-http", "vulnerability", "critical"],
    ["acme-json", "vulnerability", "high"],
  ]);
  expect(report.issues[0]?.fixedIn).toBe("1.0.1");
  expect(report.issues.every((i) => i.group === "prod")).toBe(true);

  const gate = Object.fromEntries(report.gate.map((g) => [`${g.name}@${g.version}`, g.verdict]));
  expect(gate).toEqual({
    "acme-http@1.0.1": "block",
    "acme-json@2.1.4": "allow",
    "acme-json@2.2.0": "allow",
  });

  expect(report.unfixable).toEqual([
    { name: "acme-http", reason: "every candidate fix was blocked by the supply-chain gate" },
  ]);

  expect(report.plans.map((p) => p.id)).toEqual(["minimal", "latest"]);
  expect(report.plans[0]?.changes).toEqual([
    { name: "acme-json", from: "2.1.0", to: "2.1.4", inRange: true, level: "patch" },
  ]);
  expect(report.plans[1]?.changes).toEqual([
    { name: "acme-json", from: "2.1.0", to: "2.2.0", inRange: true, level: "minor" },
  ]);
  expect(report.plans[0]?.verification?.passed).toBe(true);
  expect(report.plans[0]?.verification?.steps.map((s) => s.name)).toEqual(["install", "test"]);
  expect(report.recommended).toBe("minimal");
  expect(report.applied).toBeUndefined();
  expect(report.notes).toEqual([]);
});

test("doctor with verify disabled recommends the minimal plan without running workers", async () => {
  const verifier = fakeVerifier(fixturePkgJson);
  const report = await runDoctor(
    doctorProject,
    { verify: false },
    { check: engineCheck, verifier: verifier.deps },
  );
  expect(report.recommended).toBe("minimal");
  expect(report.plans[0]?.verification).toBeUndefined();
  expect(verifier.calls).toEqual([]);
});

test("doctor recommends nothing when every plan fails verification", async () => {
  const verifier = fakeVerifier(fixturePkgJson, 1);
  const report = await runDoctor(
    doctorProject,
    { apply: true },
    { check: engineCheck, verifier: verifier.deps },
  );
  expect(report.recommended).toBeUndefined();
  expect(report.applied).toBeUndefined();
  expect(report.plans.every((p) => p.verification?.passed === false)).toBe(true);
});

test("doctor --apply rewrites the project manifest after a verified plan", async () => {
  const verifier = fakeVerifier(fixturePkgJson);
  const report = await runDoctor(
    doctorProject,
    { apply: true },
    { check: engineCheck, verifier: verifier.deps },
  );
  expect(report.applied).toBe(true);
  const patched = verifier.written[join(doctorProject, "package.json")];
  expect(patched).toContain('"acme-json": "2.1.4"');
  expect(patched).toContain('"acme-http": "^1.0.0"');
});

test("doctor reports a clean project with no plans", async () => {
  const fs = memFs({
    [join("/clean", "package.json")]: JSON.stringify({
      name: "clean-demo",
      dependencies: { "left-pad": "^1.3.0" },
    }),
  });
  const report = await runDoctor("/clean", {}, { fs, check: engineCheck });
  expect(report.issues).toEqual([]);
  expect(report.plans).toEqual([]);
  expect(report.gate).toEqual([]);
  expect(report.recommended).toBeUndefined();
});

test("doctor notes unknown packages, unmatched ranges, and advisory outages", async () => {
  const fs = memFs({
    [join("/odd", "package.json")]: JSON.stringify({
      name: "odd-demo",
      dependencies: { "wnpm-no-such-package-xyz": "^1.0.0", "left-pad": "^9.0.0" },
    }),
  });
  const report = await runDoctor("/odd", {}, { fs, check: engineCheck });
  expect(report.notes).toEqual([
    "wnpm-no-such-package-xyz: not found on the registry; skipped",
    'left-pad: no installed version matches range "^9.0.0"; skipped',
  ]);
  expect(report.issues).toEqual([]);

  process.env.WNPM_OSV = "http://127.0.0.1:1";
  try {
    const outage = await runDoctor(
      "/odd",
      {},
      {
        fs: memFs({
          [join("/odd", "package.json")]: JSON.stringify({
            dependencies: { "left-pad": "^1.3.0" },
          }),
        }),
        check: engineCheck,
      },
    );
    expect(outage.notes).toEqual([
      "left-pad: advisory lookup failed; treating vulnerabilities as unknown",
    ]);
  } finally {
    process.env.WNPM_OSV = reg.url;
  }
});

function stubbedDeps(
  versions: string[],
  vulnFixed: string | undefined,
  verdictFor: (spec: string) => Verdict["verdict"],
): DoctorDeps {
  const meta: PackageMeta = {
    name: "stub-lib",
    version: versions[versions.length - 1] as string,
    existsOnRegistry: true,
    versions,
    maintainers: ["stub"],
  };
  return {
    fs: memFs({
      [join("/stub", "package.json")]: JSON.stringify({
        name: "stub-demo",
        dependencies: { "stub-lib": "^1.0.0" },
      }),
      [join("/stub", "node_modules", "stub-lib", "package.json")]: JSON.stringify({
        version: "1.0.0",
      }),
    }),
    resolve: () => Promise.resolve(meta),
    vulns: () =>
      Promise.resolve([
        osvRecord({
          id: "GHSA-STUB-0001",
          package: "stub-lib",
          summary: "stub advisory",
          severity: "high",
          introduced: "0",
          fixed: vulnFixed,
        }),
      ]),
    check: (spec) =>
      Promise.resolve({
        schema_version: SCHEMA_VERSION,
        package: spec.slice(0, spec.lastIndexOf("@")),
        version: spec.slice(spec.lastIndexOf("@") + 1),
        integrity: "",
        verdict: verdictFor(spec),
        risk_score: 0,
        categories: [],
        summary: "stub verdict",
        evidence: [],
        analyzer_version: "0.1.0",
        source: "heuristics",
      }),
  };
}

test("doctor marks a package unfixable when no release fixes the advisory", async () => {
  const deps = stubbedDeps(["1.0.0"], undefined, () => "allow");
  const report = await runDoctor("/stub", { verify: false }, deps);
  expect(report.unfixable).toEqual([
    { name: "stub-lib", reason: "no published version fixes the reported issues" },
  ]);
  expect(report.plans).toEqual([]);
});

test("doctor reports deprecated packages without planning an upgrade", async () => {
  const deps = stubbedDeps(["1.0.0", "1.1.0"], undefined, () => "allow");
  deps.vulns = () => Promise.resolve([]);
  deps.resolve = () =>
    Promise.resolve({
      name: "stub-lib",
      version: "1.1.0",
      existsOnRegistry: true,
      versions: ["1.0.0", "1.1.0"],
      maintainers: ["stub"],
      deprecated: true,
    });
  const report = await runDoctor("/stub", { verify: false }, deps);
  expect(report.issues).toEqual([
    {
      name: "stub-lib",
      group: "prod",
      installed: "1.0.0",
      kind: "deprecated",
      summary: "the latest release of stub-lib is deprecated on the registry",
    },
  ]);
  expect(report.plans).toEqual([]);
  expect(report.gate).toEqual([]);
});

test("doctor --apply with --no-verify applies the unverified minimal plan", async () => {
  const deps = stubbedDeps(["1.0.0", "1.0.1"], "1.0.1", () => "allow");
  const written: Record<string, string> = {};
  const calls: string[][] = [];
  deps.verifier = {
    exec: (cmd) => {
      calls.push(cmd);
      return { code: 0 };
    },
    mkWorkspace: () => "/workspace",
    readFile: () => JSON.stringify({ dependencies: { "stub-lib": "^1.0.0" } }),
    writeFile: (path, content) => {
      written[path] = content;
    },
    which: () => null,
    now: () => 0,
  };
  const report = await runDoctor("/stub", { verify: false, apply: true }, deps);
  expect(report.recommended).toBe("minimal");
  expect(report.applied).toBe(true);
  expect(report.plans[0]?.verification).toBeUndefined();
  expect(written[join("/stub", "package.json")]).toContain('"stub-lib": "1.0.1"');
  expect(calls).toHaveLength(1);
});

test("doctor accepts warn-verdict candidates and surfaces the warning in the gate", async () => {
  const deps = stubbedDeps(["1.0.0", "1.0.1"], "1.0.1", () => "warn");
  const report = await runDoctor("/stub", { verify: false }, deps);
  expect(report.gate).toEqual([
    {
      name: "stub-lib",
      version: "1.0.1",
      verdict: "warn",
      categories: [],
      summary: "stub verdict",
    },
  ]);
  expect(report.plans[0]?.changes[0]?.to).toBe("1.0.1");
  expect(report.unfixable).toEqual([]);
});

test("doctor falls back to the latest pick when early candidates are blocked", async () => {
  const blocked = new Set(["stub-lib@1.0.1", "stub-lib@1.0.2", "stub-lib@1.0.3"]);
  const deps = stubbedDeps(
    ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4", "1.0.5"],
    "1.0.1",
    (spec) => (blocked.has(spec) ? "block" : "allow"),
  );
  const report = await runDoctor("/stub", { verify: false }, deps);
  expect(report.unfixable).toEqual([]);
  expect(report.plans).toHaveLength(1);
  expect(report.plans[0]?.changes).toEqual([
    { name: "stub-lib", from: "1.0.0", to: "1.0.5", inRange: true, level: "patch" },
  ]);
  expect(report.gate.filter((g) => g.verdict === "block")).toHaveLength(3);
});
