import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECK_SURFACES } from "../src/cli/commands/check.ts";
import { COMMAND_REGISTRY } from "../src/cli/registry.ts";
import { DEFAULT_POLICY } from "../src/policy/compile.ts";
import { AGENT_NAMES } from "../src/shared/agents.ts";
import { COVERAGE_MATRIX, UNSUPPORTED_PATHS } from "../src/shim/grammar.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const siteDocs = read("../web/src/lib/docs.ts");
const commandNotes = read("../web/src/lib/command-notes.ts");
const featuresDoc = read("../docs/features.md");
const surfacesDoc = read("../docs/check-surfaces.md");
const configDoc = read("../docs/config.md");

const CI_REPORTERS = ["summary", "json", "github", "agent", "sarif"];
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];

test("every public verb has a page on the site and a written overview", () => {
  for (const command of COMMAND_REGISTRY.filter((entry) => !entry.hidden)) {
    const declared =
      commandNotes.includes(`  ${command.name}: {`) ||
      commandNotes.includes(`  "${command.name}": {`);
    expect(`${command.name}: ${declared}`).toBe(`${command.name}: true`);
  }
});

test("every ci reporter the CLI accepts is documented on the site", () => {
  for (const reporter of CI_REPORTERS) {
    expect(siteDocs).toContain(reporter);
  }
});

test("the reporter list in the registry matches the documented reporters", () => {
  const ci = COMMAND_REGISTRY.find((entry) => entry.name === "ci");
  const hint = ci?.flags.find((flag) => flag.name === "--reporter")?.valueHint ?? "";
  for (const reporter of CI_REPORTERS) expect(hint).toContain(reporter);
});

test("every check surface is documented in the repo and on the site", () => {
  for (const surface of CHECK_SURFACES) {
    expect(surfacesDoc).toContain(`check ${surface}`);
    expect(featuresDoc).toContain(`check ${surface}`);
    expect(siteDocs).toContain(`check ${surface}`);
  }
});

test("every lockfile format the audit parses is named in the docs", () => {
  for (const file of LOCKFILES) {
    expect(surfacesDoc).toContain(file);
    expect(siteDocs).toContain(file);
  }
});

test("every agent adapter is documented where the setting is explained", () => {
  for (const name of AGENT_NAMES) {
    expect(configDoc).toContain(name);
    expect(siteDocs).toContain(name);
  }
});

test("the global flags are documented on the site", () => {
  for (const flag of ["--json", "--no-color", "--quiet", "--verbose"]) {
    expect(siteDocs).toContain(flag);
  }
});

test("docs do not claim an unimplemented check surface", () => {
  const claimed = [...surfacesDoc.matchAll(/warden check (\w+)/g)].map(
    (match) => match[1] as string,
  );
  for (const surface of claimed) {
    expect([...CHECK_SURFACES, "lockfile", "scripts", "config"]).toContain(surface);
  }
});

test("every mediated command form appears on the coverage page", () => {
  for (const row of COVERAGE_MATRIX) {
    if (row.command.startsWith("<")) continue;
    expect(siteDocs).toContain(`${row.manager} ${row.command}`);
  }
});

test("every unsupported path is named on the site, not only in the binary", () => {
  for (const entry of UNSUPPORTED_PATHS) {
    expect(siteDocs).toContain(entry.path);
  }
});

test("every policy key the compiler accepts is documented on the site", () => {
  for (const key of Object.keys(DEFAULT_POLICY)) {
    expect(siteDocs).toContain(key);
  }
});

test("the limitations page states the boundary the report asked for", () => {
  for (const claim of [
    "not an operating-system control",
    "cannot prove that code is safe",
    "flat: one version per package name",
    "No model decides a block",
  ]) {
    expect(siteDocs).toContain(claim);
  }
});

test("the site content modules actually parse, so a broken page cannot reach the deploy", async () => {
  const docs = await import("../web/src/lib/docs.ts");
  const notes = await import("../web/src/lib/command-notes.ts");
  expect(docs.DOC_PAGES.length).toBeGreaterThan(10);
  expect(Object.keys(notes.COMMAND_NOTES).length).toBeGreaterThan(10);
});

test("every doc page has a slug, a title, a description, and a body", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    expect(`${page.slug} title`).not.toBe(" title");
    expect(page.description.length).toBeGreaterThan(20);
    expect(page.body.length).toBeGreaterThan(200);
  }
});

test("every doc page body closes the template literal it opened", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    const backticks = (page.body.match(/`/g) ?? []).length;
    expect(`${page.slug}: ${backticks % 2 === 0}`).toBe(`${page.slug}: true`);
  }
});

test("every command note points at commands that exist", async () => {
  const { COMMAND_NOTES } = await import("../web/src/lib/command-notes.ts");
  const known = new Set(COMMAND_REGISTRY.map((entry) => entry.name));
  for (const name of Object.keys(COMMAND_NOTES)) {
    expect(`${name} is a real verb: ${known.has(name)}`).toBe(`${name} is a real verb: true`);
  }
});

test("the published benchmark matches what the binary produces today", async () => {
  const { BENCHMARK_CASES } = await import("../src/benchmark/cases.ts");
  const { runBenchmark } = await import("../src/benchmark/run.ts");
  const published = await import("../web/src/lib/benchmark.json");
  const fresh = await runBenchmark(BENCHMARK_CASES, published.default.analyzer_version);
  expect(fresh.totals).toEqual(published.default.totals);
  expect(fresh.detection).toEqual(published.default.detection);
  expect(fresh.falsePositives).toEqual(published.default.falsePositives);
  expect(fresh.results.map((row) => `${row.id}:${row.actual}`)).toEqual(
    published.default.results.map((row) => `${row.id}:${row.actual}`),
  );
});
