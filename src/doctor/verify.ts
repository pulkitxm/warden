import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Change } from "./plan.ts";
import { type Project, stripBom } from "./project.ts";

export interface VerifyDeps {
  exec: (cmd: string[], cwd: string) => { code: number };
  mkWorkspace: (fromDir: string) => string;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  which: (cmd: string) => string | null;
  now: () => number;
}

const SKIP_COPY = new Set(["node_modules", ".git", "dist", "coverage"]);

export const defaultVerifyDeps: VerifyDeps = {
  exec: (cmd, cwd) => {
    const env: Record<string, string | undefined> = { ...process.env };
    if (process.env.WNPM_REGISTRY) env.npm_config_registry = process.env.WNPM_REGISTRY;
    try {
      const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env });
      return { code: r.exitCode ?? 1 };
    } catch {
      return { code: 127 };
    }
  },
  mkWorkspace: (fromDir) => {
    const dst = mkdtempSync(join(tmpdir(), "wnpm-doctor-"));
    cpSync(fromDir, dst, {
      recursive: true,
      filter: (src) => !SKIP_COPY.has(basename(src)),
    });
    return dst;
  },
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, content) => writeFileSync(path, content),
  which: (cmd) => Bun.which(cmd),
  now: () => Date.now(),
};

export interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
}

export interface VerificationResult {
  workspace: string;
  passed: boolean;
  steps: StepResult[];
}

export function applyChanges(pkgJsonText: string, changes: Change[]): string {
  const pkg = JSON.parse(stripBom(pkgJsonText)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const change of changes) {
    for (const map of [pkg.dependencies, pkg.devDependencies]) {
      if (!map || map[change.name] === undefined) continue;
      map[change.name] = change.to;
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function installCommand(pm: "bun" | "npm"): string[] {
  return pm === "bun"
    ? ["bun", "install", "--ignore-scripts"]
    : ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
}

export function availablePm(project: Project, deps: VerifyDeps): "bun" | "npm" | null {
  if (project.packageManager === "bun" && deps.which("bun")) return "bun";
  if (deps.which("npm")) return "npm";
  if (deps.which("bun")) return "bun";
  return null;
}

function runSteps(
  dir: string,
  project: Project,
  pm: "bun" | "npm",
  deps: VerifyDeps,
): { passed: boolean; steps: StepResult[] } {
  const steps: StepResult[] = [];
  const run = (name: string, cmd: string[]): boolean => {
    const started = deps.now();
    const { code } = deps.exec(cmd, dir);
    steps.push({ name, ok: code === 0, ms: deps.now() - started });
    return code === 0;
  };
  let ok = run("install", installCommand(pm));
  for (const script of ["test", "typecheck", "build"]) {
    if (!ok) break;
    if (!project.scripts[script]) continue;
    ok = run(script, [pm, "run", script]);
  }
  return { passed: ok, steps };
}

export function verifyPlan(
  project: Project,
  changes: Change[],
  deps: VerifyDeps = defaultVerifyDeps,
): VerificationResult {
  const pm = availablePm(project, deps);
  if (!pm) return { workspace: "", passed: false, steps: [] };
  const workspace = deps.mkWorkspace(project.dir);
  const pkgPath = join(workspace, "package.json");
  deps.writeFile(pkgPath, applyChanges(deps.readFile(pkgPath), changes));
  const { passed, steps } = runSteps(workspace, project, pm, deps);
  return { workspace, passed, steps };
}

export function applyPlan(
  project: Project,
  changes: Change[],
  deps: VerifyDeps = defaultVerifyDeps,
): { applied: boolean; steps: StepResult[] } {
  const pm = availablePm(project, deps);
  if (!pm) return { applied: false, steps: [] };
  const pkgPath = join(project.dir, "package.json");
  const original = deps.readFile(pkgPath);
  deps.writeFile(pkgPath, applyChanges(original, changes));
  const started = deps.now();
  let code = 127;
  try {
    code = deps.exec(installCommand(pm), project.dir).code;
  } finally {
    if (code !== 0) deps.writeFile(pkgPath, original);
  }
  const steps = [{ name: "install", ok: code === 0, ms: deps.now() - started }];
  return { applied: code === 0, steps };
}
