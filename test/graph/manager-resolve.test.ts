import { expect, test } from "bun:test";
import {
  lockfileOnlyCommand,
  type ManagerResolveDeps,
  resolveWithManager,
} from "../../src/graph/manager-resolve.ts";
import { buildRequest } from "../../src/graph/request.ts";

const request = (specs: string[]) =>
  buildRequest({
    manager: "npm",
    operation: specs.length ? "add" : "install",
    argv: specs.length ? ["install", ...specs] : ["install"],
    cwd: "/repo",
    specs,
  });

const LOCK = JSON.stringify({
  packages: {
    "": { name: "root" },
    "node_modules/left-pad": {
      version: "1.3.0",
      integrity: "sha512-lp",
      resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
    },
  },
});

function makeDeps(over: Partial<ManagerResolveDeps> = {}, files: Record<string, string> = {}) {
  const store: Record<string, string> = { "/repo/package.json": "{}", ...files };
  const commands: string[][] = [];
  const removed: string[] = [];
  const deps: ManagerResolveDeps = {
    exists: (path) => path in store,
    readFile: (path) => {
      if (!(path in store)) throw new Error(`ENOENT ${path}`);
      return store[path] as string;
    },
    exec: (cmd, cwd) => {
      commands.push([...cmd]);
      store[`${cwd}/package-lock.json`] = LOCK;
      return { code: 0 };
    },
    mkTemp: () => "/tmp/w",
    copyFile: (from, to) => {
      store[to] = store[from] as string;
    },
    rm: (path) => removed.push(path),
    which: () => "/usr/bin/npm",
    ...over,
  };
  return { deps, commands, removed, store };
}

test("npm resolves lockfile-only, without running package code", () => {
  expect(lockfileOnlyCommand("npm", request(["left-pad"]))).toEqual([
    "npm",
    "install",
    "left-pad",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
});

test("pnpm uses its own lockfile-only flag", () => {
  expect(lockfileOnlyCommand("pnpm", request(["zod"]))).toEqual([
    "pnpm",
    "add",
    "zod",
    "--lockfile-only",
    "--ignore-scripts",
  ]);
});

test("yarn can refresh a lockfile but cannot add a package without installing", () => {
  expect(lockfileOnlyCommand("yarn", request([]))).toEqual([
    "yarn",
    "install",
    "--mode=update-lockfile",
  ]);
  expect(lockfileOnlyCommand("yarn", request(["zod"]))).toBeNull();
});

test("bun resolves lockfile-only too, so bun projects get the same fidelity", () => {
  expect(lockfileOnlyCommand("bun", request(["zod"]))).toEqual([
    "bun",
    "add",
    "zod",
    "--lockfile-only",
    "--ignore-scripts",
  ]);
  expect(lockfileOnlyCommand("bun", request([]))).toEqual([
    "bun",
    "install",
    "--lockfile-only",
    "--ignore-scripts",
  ]);
});

test("a successful resolution returns the manager's own graph", () => {
  const { deps, commands } = makeDeps();
  const resolved = resolveWithManager("npm", request(["left-pad"]), "/repo", deps);
  expect(resolved?.nodes.get("left-pad")).toMatchObject({
    version: "1.3.0",
    integrity: "sha512-lp",
  });
  expect(commands[0]).toContain("--package-lock-only");
});

test("the temporary workspace is always cleaned up", () => {
  const { deps, removed } = makeDeps();
  resolveWithManager("npm", request(["left-pad"]), "/repo", deps);
  expect(removed).toEqual(["/tmp/w"]);
});

test("a workspace that cannot be removed still yields the resolution", () => {
  const { deps } = makeDeps({
    rm: () => {
      throw new Error("EBUSY");
    },
  });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)?.nodes.size).toBe(1);
});

test("a manager that is not installed falls back rather than failing", () => {
  const { deps, commands } = makeDeps({ which: () => null });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
  expect(commands).toEqual([]);
});

test("a project with no manifest cannot be resolved this way", () => {
  const { deps } = makeDeps({ exists: () => false });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
});

test("a manager that exits non-zero falls back instead of inventing a graph", () => {
  const { deps } = makeDeps({ exec: () => ({ code: 1 }) });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
});

test("a manager that writes no lockfile falls back", () => {
  const { deps } = makeDeps({ exec: () => ({ code: 0 }) });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
});

test("a manager with no lockfile-only mode never reaches the workspace", () => {
  const { deps, commands } = makeDeps();
  expect(resolveWithManager("yarn", request(["zod"]), "/repo", deps)).toBeNull();
  expect(commands).toEqual([]);
});

test("a copy failure on one seed file does not abort the resolution", () => {
  const { deps } = makeDeps(
    {
      copyFile: (from) => {
        if (from.endsWith(".npmrc")) throw new Error("EACCES");
      },
    },
    { "/repo/.npmrc": "registry=https://registry.npmjs.org" },
  );
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)?.nodes.size).toBe(1);
});

test("a manifest that cannot be copied leaves nothing to resolve", () => {
  const { deps } = makeDeps({
    copyFile: () => {
      throw new Error("EACCES");
    },
  });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
});

test("a lockfile that cannot be parsed falls back", () => {
  const { deps } = makeDeps({
    exec: () => {
      throw new Error("spawn failed");
    },
  });
  expect(resolveWithManager("npm", request(["left-pad"]), "/repo", deps)).toBeNull();
});

test("yarn resolution disables scripts through the environment", () => {
  const envs: Array<Record<string, string> | undefined> = [];
  const { deps } = makeDeps({
    exec: (_cmd, _cwd, env) => {
      envs.push(env);
      return { code: 1 };
    },
  });
  resolveWithManager("yarn", request([]), "/repo", deps);
  expect(envs[0]?.YARN_ENABLE_SCRIPTS).toBe("0");
});
