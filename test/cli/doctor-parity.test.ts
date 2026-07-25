import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import {
  COMMAND_REGISTRY,
  defaultWardenDeps,
  runWarden,
  runWnpm,
  type WardenDeps,
} from "../../src/cli/main.ts";
import { type DoctorOptions, type DoctorReport, runDoctor } from "../../src/doctor/index.ts";
import { DOCTOR_JSON_SCHEMA } from "../../src/schema.ts";

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

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
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

const reportOnly = (dir: string, opts: DoctorOptions) =>
  runDoctor(dir, { ...opts, verify: false, apply: false });

test("doctor is a registered warden verb with the documented flags", () => {
  const doctor = COMMAND_REGISTRY.find((c) => c.name === "doctor");
  expect(doctor).toBeDefined();
  expect(doctor?.hidden).toBeUndefined();
  expect(doctor?.flags.map((f) => f.name).sort()).toEqual([
    "--dir",
    "--help",
    "--json",
    "--no-apply",
    "--no-verify",
  ]);
  expect(doctor?.exitCodes).toContain("10");
});

test("warden doctor and wnpm doctor produce identical reports and exit codes", async () => {
  const viaWarden = makeDeps({ doctor: reportOnly });
  const viaWnpm = makeDeps({ doctor: reportOnly });

  const wardenCode = await runWarden(["doctor", "--dir", doctorProject, "--json"], viaWarden.deps);
  const wnpmCode = await runWnpm(["doctor", "--dir", doctorProject, "--json"], viaWnpm.deps);

  expect(wardenCode).toBe(10);
  expect(wnpmCode).toBe(wardenCode);
  expect(viaWarden.out.join("")).toBe(viaWnpm.out.join(""));

  const report = JSON.parse(viaWarden.out.join("")) as DoctorReport;
  expect(report.project).toBe("doctor-demo");
  expect(report.unfixable.map((u) => u.name)).toEqual(["acme-http"]);
});

test("warden doctor forwards --dir, --no-apply and --no-verify to the doctor core", async () => {
  const seen: Array<{ dir: string; opts: DoctorOptions }> = [];
  const { deps } = makeDeps({
    doctor: (dir, opts) => {
      seen.push({ dir, opts });
      return Promise.resolve({
        schema_version: 1,
        project: "demo",
        issues: [],
        gate: [],
        unfixable: [],
        plans: [],
        audited: 1,
        skipped: 0,
        notes: [],
      } satisfies DoctorReport);
    },
  });

  expect(await runWarden(["doctor"], deps)).toBe(0);
  expect(await runWarden(["doctor", "--dir", "/proj", "--no-apply"], deps)).toBe(0);
  expect(await runWarden(["doctor", "--no-verify"], deps)).toBe(0);

  expect(seen).toEqual([
    { dir: ".", opts: { apply: true } },
    { dir: "/proj", opts: { apply: false } },
    { dir: ".", opts: { apply: true, verify: false } },
  ]);
});

test("warden doctor reports its own tool name on analysis errors", async () => {
  const { deps, err } = makeDeps();
  delete deps.doctor;
  expect(await runWarden(["doctor", "--dir", "/no/such/dir"], deps)).toBe(30);
  const text = err.join("");
  expect(text).toContain("warden doctor: analysis error");
  expect(text).not.toContain("wnpm doctor:");
});

test("warden doctor rejects positional arguments and unknown flags", async () => {
  const stray = makeDeps();
  expect(await runWarden(["doctor", "express"], stray.deps)).toBe(30);
  expect(stray.err.join("")).toContain("doctor takes no positional arguments");

  const strayJson = makeDeps();
  expect(await runWarden(["doctor", "express", "--json"], strayJson.deps)).toBe(30);
  expect(JSON.parse(strayJson.out.join("")).error.code).toBe("WARDEN_DOCTOR_USAGE");

  const bogus = makeDeps();
  expect(await runWarden(["doctor", "--bogus-flag"], bogus.deps)).toBe(30);
});

test("warden doctor --help renders usage without running the audit", async () => {
  let called = false;
  const { deps, err } = makeDeps({
    doctor: () => {
      called = true;
      return Promise.reject(new Error("should not run"));
    },
  });
  expect(await runWarden(["doctor", "--help"], deps)).toBe(0);
  expect(called).toBe(false);
  expect(err.join("")).toContain("usage: warden doctor");
});

test("the apply hint names the tool the user actually invoked", async () => {
  const viaWarden = makeDeps({ doctor: reportOnly });
  await runWarden(["doctor", "--dir", doctorProject, "--no-apply"], viaWarden.deps);
  expect(viaWarden.err.join("")).toContain("run warden doctor without --no-apply");

  const viaWnpm = makeDeps({ doctor: reportOnly });
  await runWnpm(["doctor", "--dir", doctorProject, "--no-apply"], viaWnpm.deps);
  expect(viaWnpm.err.join("")).toContain("run wnpm doctor without --no-apply");
});

test("DoctorReport keys stay inside the published doctor schema", async () => {
  const report = await reportOnly(doctorProject, {});
  const allowed = Object.keys(DOCTOR_JSON_SCHEMA.properties);
  for (const key of Object.keys(report)) expect(allowed).toContain(key);
  for (const key of DOCTOR_JSON_SCHEMA.required) expect(report).toHaveProperty(key);

  const planKeys = Object.keys(DOCTOR_JSON_SCHEMA.properties.plans.items.properties);
  for (const plan of report.plans)
    for (const key of Object.keys(plan)) expect(planKeys).toContain(key);

  const issueKeys = Object.keys(DOCTOR_JSON_SCHEMA.properties.issues.items.properties);
  for (const issue of report.issues)
    for (const key of Object.keys(issue)) expect(issueKeys).toContain(key);

  const gateKeys = Object.keys(DOCTOR_JSON_SCHEMA.properties.gate.items.properties);
  for (const record of report.gate)
    for (const key of Object.keys(record)) expect(gateKeys).toContain(key);
});

test("warden schema exposes every major report type", async () => {
  const list = makeDeps();
  expect(await runWarden(["schema", "list"], list.deps)).toBe(0);
  expect(JSON.parse(list.out.join("")).schemas).toEqual([
    "check",
    "ci",
    "audit",
    "doctor",
    "intent",
  ]);

  for (const verb of ["check", "ci", "audit", "doctor", "intent"]) {
    const { deps, out } = makeDeps();
    expect(await runWarden(["schema", verb], deps)).toBe(0);
    expect(JSON.parse(out.join("")).type).toBeDefined();
  }

  const unknown = makeDeps();
  expect(await runWarden(["schema", "nope"], unknown.deps)).toBe(30);
  expect(JSON.parse(unknown.out.join("")).error.hint).toContain("doctor");
});

test("completions offer doctor and its flags for both warden and wnpm", async () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const { deps, out } = makeDeps();
    expect(await runWarden(["completions", shell], deps)).toBe(0);
    const script = out.join("");
    expect(script).toContain("doctor");
    expect(script).toContain("no-apply");
    expect(script).toContain("no-verify");
    expect(script).toContain("wnpm");
  }
});
