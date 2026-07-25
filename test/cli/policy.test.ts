import { expect, test } from "bun:test";
import { join } from "node:path";
import { readProjectPolicy } from "../../src/cli/commands/policy.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";

function makeDeps(files: Record<string, string> = {}, onPath: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => CWD,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    which: (cmd) => (onPath.includes(cmd) ? `/usr/bin/${cmd}` : null),
    check: () => Promise.reject(new Error("unused")),
  };
  return { deps, out, err };
}

test("the compiled policy follows the manager the project actually declares", async () => {
  setColor(false);
  const { deps, out } = makeDeps({ [join(CWD, "pnpm-lock.yaml")]: "" });
  expect(await runWarden(["policy", "--json"], deps)).toBe(0);
  expect(JSON.parse(out[0] as string).compiled.manager).toBe("pnpm");
});

test("--manager compiles for a manager the project does not use", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "pnpm-lock.yaml")]: "" });
  await runWarden(["policy", "--manager", "bun", "--json"], deps);
  expect(JSON.parse(out[0] as string).compiled.manager).toBe("bun");
});

test("an unknown manager is a usage error rather than a silent default", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["policy", "--manager", "cnpm", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_POLICY_MANAGER");
});

test("the project policy in warden.config.json overrides the defaults", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "warden.config.json")]: JSON.stringify({ policy: { minimumReleaseAgeDays: 14 } }),
  });
  await runWarden(["policy", "--manager", "pnpm", "--json"], deps);
  const payload = JSON.parse(out[0] as string);
  expect(payload.policy.minimumReleaseAgeDays).toBe(14);
  expect(
    payload.compiled.settings.find((entry: { key: string }) => entry.key === "minimumReleaseAge")
      .value,
  ).toBe("20160");
});

test("a config with no policy section still compiles the defaults", () => {
  const { deps } = makeDeps({
    [join(CWD, "warden.config.json")]: JSON.stringify({ mode: "brief" }),
  });
  expect(readProjectPolicy(deps, CWD)).toBeUndefined();
});

test("a corrupt config does not take the policy down with it", () => {
  const { deps } = makeDeps({ [join(CWD, "warden.config.json")]: "{not json" });
  expect(readProjectPolicy(deps, CWD)).toBeUndefined();
});

test("the human report names the intent, the native settings, and the gaps", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["policy", "--manager", "bun"], deps);
  const text = err.join("");
  expect(text).toContain("Policy compiled for bun");
  expect(text).toContain("trustedDependencies");
  expect(text).toContain("Not natively supported");
  expect(text).toContain("Enforced by warden regardless");
});

test("a manager with no gaps prints no gap section", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["policy", "--manager", "pnpm"], deps);
  expect(err.join("")).not.toContain("Not natively supported");
});

test("a policy with nothing to compile says so instead of printing an empty list", async () => {
  setColor(false);
  const { deps, err } = makeDeps({
    [join(CWD, "warden.config.json")]: JSON.stringify({
      policy: {
        scripts: "allow",
        minimumReleaseAgeDays: 0,
        exoticSources: "allow",
        lockfile: "trust",
        downgrades: "allow",
      },
    }),
  });
  await runWarden(["policy", "--manager", "bun"], deps);
  expect(err.join("")).toContain("no native setting");
});

test("--quiet suppresses the human report", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  expect(await runWarden(["policy"], deps)).toBe(0);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});
