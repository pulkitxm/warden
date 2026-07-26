import { createHash } from "node:crypto";
import type { PackageManager } from "../shared/manager.ts";

export type TransactionOperation =
  | "install"
  | "frozen-install"
  | "add"
  | "update"
  | "global-install"
  | "rebuild"
  | "exec";

export interface TransactionRequest {
  schema_version: 1;
  manager: PackageManager;
  operation: TransactionOperation;
  argv: string[];
  cwd: string;
  specs: string[];
  workspace?: string;
  dependencyClass?: "prod" | "dev" | "optional" | "peer";
  exact?: boolean;
  global?: boolean;
}

const DEV_FLAGS = new Set(["--save-dev", "-D", "--dev"]);
const OPTIONAL_FLAGS = new Set(["--save-optional", "-O"]);
const PEER_FLAGS = new Set(["--save-peer"]);
const EXACT_FLAGS = new Set(["--save-exact", "-E", "--exact"]);
const GLOBAL_FLAGS = new Set(["-g", "--global"]);
const WORKSPACE_FLAGS = new Set(["--workspace", "-w", "--filter", "--scope"]);

const SUPPRESSION_FLAGS = new Set(["--ignore-scripts"]);

export function dependencyClassOf(argv: string[]): TransactionRequest["dependencyClass"] {
  if (argv.some((arg) => DEV_FLAGS.has(arg))) return "dev";
  if (argv.some((arg) => OPTIONAL_FLAGS.has(arg))) return "optional";
  if (argv.some((arg) => PEER_FLAGS.has(arg))) return "peer";
  return "prod";
}

export function workspaceOf(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    const equals = arg.indexOf("=");
    if (equals > 0 && WORKSPACE_FLAGS.has(arg.slice(0, equals))) return arg.slice(equals + 1);
    if (WORKSPACE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value && !value.startsWith("-")) return value;
    }
  }
  return undefined;
}

export function buildRequest(input: {
  manager: PackageManager;
  operation: TransactionOperation;
  argv: string[];
  cwd: string;
  specs: string[];
}): TransactionRequest {
  const workspace = workspaceOf(input.argv);
  const dependencyClass = dependencyClassOf(input.argv);
  return {
    schema_version: 1,
    manager: input.manager,
    operation: input.operation,
    argv: [...input.argv],
    cwd: input.cwd,
    specs: [...input.specs],
    ...(workspace ? { workspace } : {}),
    ...(dependencyClass === "prod" ? {} : { dependencyClass }),
    ...(input.argv.some((arg) => EXACT_FLAGS.has(arg)) ? { exact: true } : {}),
    ...(input.argv.some((arg) => GLOBAL_FLAGS.has(arg)) ? { global: true } : {}),
  };
}

export function requestDigest(request: TransactionRequest): string {
  const canonical = JSON.stringify({
    manager: request.manager,
    operation: request.operation,
    argv: request.argv,
    cwd: request.cwd,
    workspace: request.workspace ?? null,
    dependencyClass: request.dependencyClass ?? "prod",
    exact: request.exact ?? false,
    global: request.global ?? false,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function suppressionFor(manager: PackageManager): {
  flags: string[];
  env: Record<string, string>;
} {
  if (manager === "yarn") return { flags: [], env: { YARN_ENABLE_SCRIPTS: "0" } };
  return { flags: ["--ignore-scripts"], env: {} };
}

export function replayCommand(request: TransactionRequest): {
  argv: string[];
  env: Record<string, string>;
} {
  const suppression = suppressionFor(request.manager);
  const argv = [request.manager, ...request.argv.filter((arg) => !SUPPRESSION_FLAGS.has(arg))];
  return { argv: [...argv, ...suppression.flags], env: suppression.env };
}
