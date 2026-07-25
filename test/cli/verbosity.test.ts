import { afterEach, expect, test } from "bun:test";
import { DOCS_BASE } from "../../src/cli/help.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { COMMAND_REGISTRY } from "../../src/cli/registry.ts";
import { renderVerdict } from "../../src/cli/ui.ts";
import { ANALYZER_VERSION, SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { isQuiet, isVerbose, setVerbosity, verbosity } from "../../src/shared/output.ts";

afterEach(() => setVerbosity("normal"));

const HOSTILE_LOCK = JSON.stringify({
  packages: {
    "": {},
    "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.help/a.tgz" },
  },
});

function makeDeps(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/u",
    cwd: () => "/proj",
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in files,
    glob: () => [],
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
  };
  return { deps, out, err };
}

const verdict = (evidence: number): Verdict => ({
  schema_version: SCHEMA_VERSION,
  package: "pkg",
  version: "1.0.0",
  integrity: "sha512-x",
  verdict: "block",
  risk_score: 80,
  categories: [],
  summary: "blocked",
  evidence: Array.from({ length: evidence }, (_, index) => ({
    file: "-",
    detail: `signal ${index}`,
  })),
  analyzer_version: ANALYZER_VERSION,
  source: "heuristics",
});

test("verbosity defaults to normal", () => {
  expect(verbosity()).toBe("normal");
  expect(isQuiet()).toBe(false);
  expect(isVerbose()).toBe(false);
});

test("--quiet suppresses the human report but keeps the exit code", async () => {
  const { deps, err } = makeDeps({ "/proj/package-lock.json": HOSTILE_LOCK });
  expect(await runWarden(["check", "lockfile", "--quiet"], deps)).toBe(20);
  expect(err.join("")).toBe("");
  expect(isQuiet()).toBe(true);
});

test("without --quiet the same run prints a report", async () => {
  const { deps, err } = makeDeps({ "/proj/package-lock.json": HOSTILE_LOCK });
  expect(await runWarden(["check", "lockfile"], deps)).toBe(20);
  expect(err.join("")).toContain("lockfile_lookalike_registry");
});

test("--quiet still emits JSON when asked", async () => {
  const { deps, out } = makeDeps({ "/proj/package-lock.json": HOSTILE_LOCK });
  expect(await runWarden(["check", "lockfile", "--quiet", "--json"], deps)).toBe(20);
  expect(JSON.parse(out.join("")).findings.length).toBeGreaterThan(0);
});

test("--quiet still reports errors", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["check", "--quiet"], deps)).toBe(30);
  expect(err.join("")).toContain("check requires at least one package");
});

test("the verbosity flags are consumed, not passed to the verb", async () => {
  const { deps, err } = makeDeps({ "/proj/package-lock.json": HOSTILE_LOCK });
  expect(await runWarden(["check", "lockfile", "--verbose"], deps)).toBe(20);
  expect(err.join("")).not.toContain("takes no further positional arguments");
});

test("--verbose lifts the evidence cap in rendered verdicts", () => {
  setColor(false);
  setVerbosity("normal");
  const brief = renderVerdict(verdict(10));
  expect(brief).toContain("signal 5");
  expect(brief).not.toContain("signal 6");
  expect(brief).toContain("4 more signal(s), rerun with --verbose");

  setVerbosity("verbose");
  const full = renderVerdict(verdict(10));
  expect(full).toContain("signal 9");
  expect(full).not.toContain("rerun with --verbose");
});

test("a short verdict never advertises the verbose hint", () => {
  setColor(false);
  setVerbosity("normal");
  expect(renderVerdict(verdict(2))).not.toContain("rerun with --verbose");
});

test("every visible verb prints a learn more link", async () => {
  for (const command of COMMAND_REGISTRY.filter((entry) => !entry.hidden)) {
    const { deps, err } = makeDeps();
    await runWarden([command.name, "--help"], deps);
    const text = err.join("");
    expect(text).toContain(`learn more: ${DOCS_BASE}/`);
  }
});

test("verbs with a deep guide link to it rather than the reference page", async () => {
  const { deps, err } = makeDeps();
  await runWarden(["doctor", "--help"], deps);
  expect(err.join("")).toContain(`learn more: ${DOCS_BASE}/doctor`);

  const check = makeDeps();
  await runWarden(["check", "--help"], check.deps);
  expect(check.err.join("")).toContain(`learn more: ${DOCS_BASE}/cli/check`);
});

test("root help points at the docs site", async () => {
  const { deps, err } = makeDeps();
  await runWarden(["--help"], deps);
  expect(err.join("")).toContain("docs: https://warden.pulkit.page/docs");
});
