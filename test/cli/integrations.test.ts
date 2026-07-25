import { expect, test } from "bun:test";
import { join } from "node:path";
import { collectIntegrations, renderIntegrations } from "../../src/cli/commands/integrations.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const HOME = "/home/u";
const CWD = "/repo";
const SHIMS = join(HOME, ".warden", "shims");

function makeDeps(files: Record<string, string> = {}, onPath: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: HOME,
    cwd: () => CWD,
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    which: (cmd) => (onPath.includes(cmd) ? `/usr/bin/${cmd}` : null),
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
  };
  return { deps, out, err };
}

const shimTree = (tools: string[]) =>
  Object.fromEntries([[SHIMS, ""], ...tools.map((tool) => [join(SHIMS, tool), ""])]);

test("a bare environment reports missing shims without failing hard", () => {
  const report = collectIntegrations(makeDeps().deps);
  const shims = report.checks.find((check) => check.name === "shims installed");
  expect(shims?.status).toBe("warn");
  expect(shims?.fix).toContain("installer");
  expect(report.healthy).toBe(true);
});

test("an installed shim set reports each intercepted tool", () => {
  const { deps } = makeDeps(shimTree(["npm", "npx"]), ["npm", "npx"]);
  const report = collectIntegrations(deps);
  expect(report.checks.find((check) => check.name === "intercept npm")?.status).toBe("ok");
  expect(report.checks.find((check) => check.name === "intercept npx")?.status).toBe("ok");
});

test("a tool that is on PATH but not shimmed is surfaced, not hidden", () => {
  const { deps } = makeDeps(shimTree(["npm"]), ["npm", "pnpm"]);
  const report = collectIntegrations(deps);
  const pnpm = report.checks.find((check) => check.name === "intercept pnpm");
  expect(pnpm?.status).toBe("info");
  expect(pnpm?.fix).toContain("pnpm");
});

test("shim precedence fails when the shim directory is not on PATH", () => {
  const previous = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  const report = collectIntegrations(makeDeps(shimTree(["npm"])).deps);
  const precedence = report.checks.find((check) => check.name === "shim precedence");
  expect(precedence?.status).toBe("fail");
  expect(report.healthy).toBe(false);
  process.env.PATH = previous;
});

test("shim precedence passes when the shim directory is first", () => {
  const previous = process.env.PATH;
  process.env.PATH = `${SHIMS}:/usr/bin`;
  const report = collectIntegrations(makeDeps(shimTree(["npm"])).deps);
  expect(report.checks.find((check) => check.name === "shim precedence")?.status).toBe("ok");
  process.env.PATH = previous;
});

test("shim precedence warns when the shim directory is later on PATH", () => {
  const previous = process.env.PATH;
  process.env.PATH = `/usr/bin:${SHIMS}`;
  const report = collectIntegrations(makeDeps(shimTree(["npm"])).deps);
  const precedence = report.checks.find((check) => check.name === "shim precedence");
  expect(precedence?.status).toBe("warn");
  expect(precedence?.detail).toContain("position 2");
  process.env.PATH = previous;
});

test("interception turned off is reported as a warning with the fix", () => {
  const { deps } = makeDeps({
    [join(HOME, ".warden", "config.json")]: JSON.stringify({
      intercept: { install: false, exec: true },
    }),
  });
  const check = collectIntegrations(deps).checks.find((entry) => entry.name === "interception");
  expect(check?.status).toBe("warn");
  expect(check?.detail).toContain("install off");
  expect(check?.fix).toContain("warden config intercept");
});

test("the configured agent adapter is reported", () => {
  const { deps } = makeDeps({
    [join(HOME, ".warden", "config.json")]: JSON.stringify({ agent: { name: "codex" } }),
  });
  const check = collectIntegrations(deps).checks.find((entry) => entry.name === "agent adapter");
  expect(check?.status).toBe("ok");
  expect(check?.detail).toBe("codex");
});

test("an ambiguous project manager is a warning, because guessing is the bug", () => {
  const { deps } = makeDeps({}, ["pnpm"]);
  const check = collectIntegrations(deps).checks.find((entry) => entry.name === "project manager");
  expect(check?.status).toBe("warn");
  expect(check?.fix).toContain("lockfile");
});

test("a declared project manager is reported with its evidence", () => {
  const { deps } = makeDeps({ [join(CWD, "pnpm-lock.yaml")]: "" });
  const check = collectIntegrations(deps).checks.find((entry) => entry.name === "project manager");
  expect(check?.status).toBe("ok");
  expect(check?.detail).toContain("pnpm-lock.yaml");
});

test("a present CI workflow is reported", () => {
  const { deps } = makeDeps({ [join(CWD, ".github", "workflows", "warden.yml")]: "" });
  const check = collectIntegrations(deps).checks.find((entry) => entry.name === "ci workflow");
  expect(check?.status).toBe("ok");
});

test("warden integrations doctor exits 0 when healthy and 30 when a check fails", async () => {
  const previous = process.env.PATH;
  process.env.PATH = `${SHIMS}:/usr/bin`;
  const healthy = makeDeps(shimTree(["npm"]));
  expect(await runWarden(["integrations", "doctor"], healthy.deps)).toBe(0);

  process.env.PATH = "/usr/bin";
  const broken = makeDeps(shimTree(["npm"]));
  expect(await runWarden(["integrations", "doctor"], broken.deps)).toBe(30);
  process.env.PATH = previous;
});

test("--json emits the machine-readable report", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["integrations", "doctor", "--json"], deps);
  const report = JSON.parse(out.join(""));
  expect(report.schema_version).toBe(1);
  expect(Array.isArray(report.checks)).toBe(true);
  expect(report.protected_commands).toBeGreaterThan(0);
  expect(report.unmediated_paths).toBeGreaterThan(0);
});

test("an unknown subcommand is rejected rather than silently treated as doctor", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["integrations", "nope"], deps)).toBe(30);
  expect(err.join("")).toContain('unknown integrations command "nope"');
});

test("bare integrations behaves as doctor", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["integrations"], deps)).toBe(0);
  expect(err.join("")).toContain("Warden integrations");
});

test("--quiet suppresses the human report", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  await runWarden(["integrations", "doctor"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("the rendered report shows fixes and points at the coverage matrix", () => {
  setColor(false);
  const text = renderIntegrations(collectIntegrations(makeDeps().deps));
  expect(text).toContain("fix:");
  expect(text).toContain("warden coverage");
  expect(text).toContain("not mediated");
});
