import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../doctor/index.ts";
import { checkPackage } from "../engine.ts";
import type { RunDeps, WardenDeps } from "../shared/deps.ts";
import { flushProgress, withoutProgress } from "../shared/progress.ts";
import { baselinesFor } from "./commands/baseline.ts";
import { selectManagers } from "./managers.ts";

export function projectBaseline(
  name: string,
  root: string = process.cwd(),
): { version: string; source: string } | undefined {
  const [baseline] = baselinesFor(defaultWardenDeps, root, [name]);
  if (!baseline || baseline.source === "none" || baseline.source === "previous-release")
    return undefined;
  return { version: baseline.version, source: baseline.source };
}

export const defaultDeps: RunDeps = {
  check: (spec) => checkPackage(spec, { baseline: projectBaseline }),
  stdout: (s) => {
    flushProgress();
    return process.stdout.write(s);
  },
  stderr: (s) => {
    flushProgress();
    return process.stderr.write(s);
  },
  which: Bun.which,
  spawn: (cmd) =>
    withoutProgress(
      () => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" }).exitCode ?? 0,
    ),
  readFile: (path) => readFileSync(path, "utf8"),
  doctor: runDoctor,
};

export const defaultWardenDeps: WardenDeps = {
  ...defaultDeps,
  home: homedir(),
  spawnIn: (cmd: string[], cwd: string, env?: Record<string, string>) =>
    withoutProgress(
      () =>
        Bun.spawnSync(cmd, {
          cwd,
          stdout: "inherit",
          stderr: "inherit",
          env: { ...process.env, ...(env ?? {}) },
        }).exitCode ?? 0,
    ),
  spawnQuiet: (cmd: string[], cwd: string, env?: Record<string, string>) =>
    Bun.spawnSync(cmd, {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, ...(env ?? {}) },
    }).exitCode ?? 0,
  mkTemp: () => mkdtempSync(join(tmpdir(), "warden-resolve-")),
  copyFile: (from: string, to: string) => copyFileSync(from, to),
  rmrf: (path: string) => rmSync(path, { recursive: true, force: true }),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: writeFileSync,
  exists: existsSync,
  cwd: process.cwd,
  glob: (pattern, cwd) => [...new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: false })],
  git: (args, cwd) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  },
  isTTY: () => Boolean(process.stdin.isTTY),
  prompt: async (question) => withoutProgress(() => globalThis.prompt(question) ?? ""),
  selectManagers,
};
