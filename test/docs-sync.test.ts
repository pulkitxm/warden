import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECK_SURFACES } from "../src/cli/commands/check.ts";
import { COMMAND_REGISTRY } from "../src/cli/registry.ts";
import { AGENT_NAMES } from "../src/shared/agents.ts";

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
