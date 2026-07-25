import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { runDoctor } from "../doctor/index.ts";
import { checkPackage } from "../engine.ts";
import type { RunDeps, WardenDeps } from "../shared/deps.ts";
import { flushProgress, withoutProgress } from "../shared/progress.ts";
import { selectManagers } from "./managers.ts";

export const defaultDeps: RunDeps = {
  check: checkPackage,
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
  spawnIn: (cmd: string[], cwd: string) =>
    withoutProgress(
      () => Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode ?? 0,
    ),
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
