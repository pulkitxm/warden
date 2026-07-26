import type { DoctorOptions, DoctorReport } from "../doctor/index.ts";
import type { Verdict } from "../schema.ts";

export interface RunDeps {
  check: (spec: string) => Promise<Verdict>;
  stdout: (s: string) => unknown;
  stderr: (s: string) => unknown;
  which: (cmd: string) => string | null;
  spawn: (cmd: string[]) => number;
  readFile: (path: string) => string;
  doctor?: (dir: string, opts: DoctorOptions) => Promise<DoctorReport>;
}

export type GitDeps = Pick<WardenDeps, "git">;

export interface WardenDeps extends RunDeps {
  spawnIn: (cmd: string[], cwd: string, env?: Record<string, string>) => number;
  spawnQuiet: (cmd: string[], cwd: string, env?: Record<string, string>) => number;
  mkTemp: () => string;
  copyFile: (from: string, to: string) => void;
  rmrf: (path: string) => void;
  home: string;
  mkdir: (path: string) => unknown;
  writeFile: (path: string, data: string) => unknown;
  exists: (path: string) => boolean;
  cwd: () => string;
  glob: (pattern: string, cwd: string) => string[];
  git: (args: string[], cwd: string) => { exitCode: number; stdout: string; stderr: string };
  isTTY: () => boolean;
  prompt: (question: string) => Promise<string>;
  selectManagers: (names: string[]) => Promise<string[]>;
}
