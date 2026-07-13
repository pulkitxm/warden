import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { defaultDeps, type RunDeps, runWnpm } from "../../src/cli/main.ts";
import { renderDoctorReport } from "../../src/cli/ui.ts";
import { runDoctor, type DoctorOptions, type DoctorReport } from "../../src/doctor/index.ts";

const doctorProject = fileURLToPath(new URL("../../fixtures/doctor-project", import.meta.url));

let reg: MiniRegistry;
let prevCache: string | undefined;

beforeAll(() => {
  reg = startMiniRegistry();
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

const strip = (s: string) =>
  s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

const cleanReport = (over: Partial<DoctorReport> = {}): DoctorReport => ({
  schema_version: 1,
  project: "demo",
  issues: [],
  gate: [],
  unfixable: [],
  plans: [],
  notes: [],
  ...over,
});

const richReport = (): DoctorReport =>
  cleanReport({
    issues: [
      {
        name: "acme-http",
        group: "prod",
        installed: "1.0.0",
        kind: "vulnerability",
        id: "GHSA-1",
        severity: "critical",
        summary: "request smuggling",
        fixedIn: "1.0.1",
      },
      { name: "old-lib", group: "dev", kind: "deprecated", summary: "old-lib is deprecated" },
    ],
    gate: [
      {
        name: "acme-http",
        version: "1.0.1",
        verdict: "block",
        categories: ["exfiltration"],
        summary: "hijacked release",
      },
      { name: "acme-json", version: "2.1.4", verdict: "allow", categories: [], summary: "clean" },
      {
        name: "acme-json",
        version: "2.2.0",
        verdict: "warn",
        categories: ["metadata_anomaly"],
        summary: "new release",
      },
    ],
    unfixable: [{ name: "acme-http", reason: "all candidates blocked" }],
    plans: [
      {
        id: "minimal",
        label: "smallest safe upgrade",
        changes: [{ name: "acme-json", from: "2.1.0", to: "2.1.4", inRange: true, level: "patch" }],
        verification: {
          passed: true,
          steps: [
            { name: "install", ok: true, ms: 120 },
            { name: "test", ok: true, ms: 300 },
          ],
        },
      },
      {
        id: "latest",
        label: "most current safe versions",
        changes: [
          { name: "acme-json", from: "2.1.0", to: "2.2.0", inRange: false, level: "minor" },
        ],
        verification: { passed: false, steps: [{ name: "install", ok: false, ms: 90 }] },
      },
    ],
    recommended: "minimal",
    notes: ["left-pad: advisory lookup failed; treating vulnerabilities as unknown"],
  });

function makeDeps(over: Partial<RunDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: RunDeps = {
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(strip(s)),
    which: () => null,
    spawn: () => 0,
    readFile: () => {
      throw new Error("ENOENT");
    },
    ...over,
  };
  return { deps, out, err };
}

test("wnpm doctor passes flags through and exits 10 when issues remain", async () => {
  const seen: Array<{ dir: string; opts: DoctorOptions }> = [];
  const { deps, out } = makeDeps({
    doctor: (dir, opts) => {
      seen.push({ dir, opts });
      return Promise.resolve(richReport());
    },
  });
  expect(await runWnpm(["doctor", "--dir", "/proj", "--json"], deps)).toBe(10);
  expect(seen).toEqual([{ dir: "/proj", opts: { apply: true } }]);
  const report = JSON.parse(out.join("")) as DoctorReport;
  expect(report.recommended).toBe("minimal");
});

test("wnpm doctor defaults to the current directory with verification on", async () => {
  const seen: Array<{ dir: string; opts: DoctorOptions }> = [];
  const { deps } = makeDeps({
    doctor: (dir, opts) => {
      seen.push({ dir, opts });
      return Promise.resolve(cleanReport());
    },
  });
  expect(await runWnpm(["doctor"], deps)).toBe(0);
  expect(seen).toEqual([{ dir: ".", opts: { apply: true } }]);
});

test("wnpm doctor exits 0 when the applied plan covers every issue", async () => {
  const full = richReport();
  const { deps, err } = makeDeps({
    doctor: (_dir, opts) =>
      Promise.resolve(
        cleanReport({
          issues: [
            {
              name: "acme-json",
              group: "prod",
              installed: "2.1.0",
              kind: "vulnerability",
              id: "GHSA-2",
              severity: "high",
              summary: "prototype pollution",
              fixedIn: "2.1.4",
            },
          ],
          plans: full.plans,
          recommended: "minimal",
          applied: opts.apply,
        }),
      ),
  });
  expect(await runWnpm(["doctor"], deps)).toBe(0);
  expect(err.join("")).toContain("recommended plan applied");
});

test("wnpm doctor still exits 10 when apply leaves an unfixable issue behind", async () => {
  const { deps, err } = makeDeps({
    doctor: (_dir, opts) =>
      Promise.resolve(cleanReport({ ...richReport(), applied: opts.apply })),
  });
  expect(await runWnpm(["doctor"], deps)).toBe(10);
  expect(err.join("")).toContain("recommended plan applied");
  expect(err.join("")).toContain("UNFIXABLE");
});

test("wnpm doctor --no-apply skips apply and exits 10 when issues remain", async () => {
  const { deps, err } = makeDeps({
    doctor: (_dir, opts) =>
      Promise.resolve(
        cleanReport({ issues: richReport().issues, applied: opts.apply, recommended: "minimal" }),
      ),
  });
  expect(await runWnpm(["doctor", "--no-apply"], deps)).toBe(10);
  expect(err.join("")).toContain("run wnpm doctor without --no-apply");
});

test("wnpm doctor renders the human report on stderr", async () => {
  const { deps, err, out } = makeDeps({ doctor: () => Promise.resolve(richReport()) });
  expect(await runWnpm(["doctor"], deps)).toBe(10);
  expect(out).toEqual([]);
  const text = err.join("");
  expect(text).toContain("Warden doctor — demo");
  expect(text).toContain("2 issue(s) found — 1 affect production");
  expect(text).toContain("request smuggling (fixed in 1.0.1)");
  expect(text).toContain("supply-chain gate on candidate fixes:");
  expect(text).toContain("BLOCK acme-http@1.0.1");
  expect(text).toContain("hijacked release");
  expect(text).toContain("WARN  acme-json@2.2.0");
  expect(text).toContain("UNFIXABLE acme-http — all candidates blocked");
  expect(text).toContain("plan minimal — smallest safe upgrade  ▸ recommended");
  expect(text).toContain("acme-json 2.1.0 -> 2.1.4  patch, in range");
  expect(text).toContain("acme-json 2.1.0 -> 2.2.0  minor, out of range");
  expect(text).toContain("install ok 120ms · test ok 300ms — passed");
  expect(text).toContain("install fail 90ms — failed");
  expect(text).toContain("note: left-pad: advisory lookup failed");
  expect(text).toContain("run wnpm doctor without --no-apply to apply the recommended plan");
});

test("wnpm doctor analysis errors exit 30", async () => {
  const { deps, err } = makeDeps({ doctor: () => Promise.reject(new Error("no manifest")) });
  expect(await runWnpm(["doctor"], deps)).toBe(30);
  expect(err.join("")).toContain("wnpm doctor: analysis error: no manifest");
});

test("renderDoctorReport covers clean and deprecated shapes", () => {
  const clean = strip(renderDoctorReport(cleanReport()));
  expect(clean).toContain("no dependency issues found");

  const deprecated = strip(
    renderDoctorReport(
      cleanReport({
        issues: [
          { name: "old-lib", group: "dev", kind: "deprecated", summary: "old-lib is deprecated" },
        ],
      }),
    ),
  );
  expect(deprecated).toContain("deprecated  old-lib");
  expect(deprecated).toContain("0 affect production");

  const moderate = strip(
    renderDoctorReport(
      cleanReport({
        issues: [
          {
            name: "meh-lib",
            group: "prod",
            installed: "1.0.0",
            kind: "vulnerability",
            severity: "moderate",
            summary: "minor issue",
          },
        ],
      }),
    ),
  );
  expect(moderate).toContain("moderate");

  const unknownSeverity = strip(
    renderDoctorReport(
      cleanReport({
        issues: [
          {
            name: "odd-lib",
            group: "prod",
            installed: "1.0.0",
            kind: "vulnerability",
            summary: "unrated issue",
          },
        ],
      }),
    ),
  );
  expect(unknownSeverity).toContain("unknown");
});

test("wnpm doctor runs end-to-end through the real doctor pipeline", async () => {
  const { deps, out } = makeDeps();
  deps.doctor = (dir, opts) => runDoctor(dir, { ...opts, verify: false, apply: false });
  const code = await runWnpm(["doctor", "--dir", doctorProject, "--json"], deps);
  expect(code).toBe(10);
  const report = JSON.parse(out.join("")) as DoctorReport;
  expect(report.project).toBe("doctor-demo");
  expect(report.issues.map((i) => i.name)).toEqual(["acme-http", "acme-json"]);
  expect(report.unfixable.map((u) => u.name)).toEqual(["acme-http"]);
  expect(report.recommended).toBe("minimal");
});

test("defaultDeps wires the real doctor implementation", () => {
  expect(typeof defaultDeps.doctor).toBe("function");
});

test("unknown flags print usage and exit 2 instead of crashing", async () => {
  const wnpm = makeDeps();
  expect(await runWnpm(["doctor", "--bogus-flag"], wnpm.deps)).toBe(2);
  expect(wnpm.err.join("")).toContain("usage: wnpm");

  const missingValue = makeDeps();
  expect(await runWnpm(["doctor", "--dir"], missingValue.deps)).toBe(2);
  expect(missingValue.err.join("")).toContain("usage: wnpm");
});

test("wnpm doctor surfaces a readable error for a missing project directory", async () => {
  const { deps, err } = makeDeps();
  delete deps.doctor;
  expect(await runWnpm(["doctor", "--dir", "/no/such/dir"], deps)).toBe(30);
  expect(err.join("")).toContain("wnpm doctor: analysis error: could not read package.json");
});
