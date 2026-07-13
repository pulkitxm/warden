import { expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shimSource = join(import.meta.dir, "../../scripts/shim.sh");
const managers = ["npm", "bun", "npx", "bunx", "pnpm", "yarn"];

type Sandbox = ReturnType<typeof createSandbox>;

function executable(path: string, body: string) {
  writeFileSync(path, body, { mode: 0o755 });
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "warden-manager-width-"));
  const home = join(root, "home");
  const shimDir = join(home, ".warden", "shims");
  const binDir = join(home, ".warden", "bin");
  const realDir = join(root, "real");
  const managerLog = join(root, "manager.log");
  const wardenLog = join(root, "warden.log");
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(realDir, { recursive: true });
  const managerStub = `#!/bin/sh
printf '%s' "\${0##*/}" >> "$MANAGER_LOG"
for arg in "$@"; do printf '\t%s' "$arg" >> "$MANAGER_LOG"; done
printf '\n' >> "$MANAGER_LOG"
exit "\${MANAGER_EXIT:-0}"
`;
  const wardenStub = `#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg" >> "$WARDEN_LOG"; done
case " $* " in
  *" --json "*) printf '{"schema_version":1,"verdict":"%s"}\n' "\${WARDEN_VERDICT:-allow}" ;;
  *) printf 'HUMAN VERDICT %s\n' "\${WARDEN_VERDICT:-allow}" >&2 ;;
esac
exit "\${WARDEN_EXIT:-0}"
`;
  for (const manager of managers) {
    const shim = join(shimDir, manager);
    copyFileSync(shimSource, shim);
    chmodSync(shim, 0o755);
    executable(join(realDir, manager), managerStub);
  }
  executable(join(binDir, "warden"), wardenStub);
  writeFileSync(
    join(home, ".warden", "config.json"),
    '{"intercept":{"install":true,"exec":true}}\n',
  );
  return { root, home, shimDir, realDir, managerLog, wardenLog };
}

function run(
  sandbox: Sandbox,
  tool: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(process.env).map((key) => [key, ""]),
  );
  Object.assign(env, {
    HOME: sandbox.home,
    PATH: `${sandbox.shimDir}:${sandbox.realDir}:/bin:/usr/bin`,
    MANAGER_LOG: sandbox.managerLog,
    WARDEN_LOG: sandbox.wardenLog,
    WARDEN_EXIT: "0",
    WARDEN_VERDICT: "allow",
    MANAGER_EXIT: "0",
    ...extraEnv,
  });
  return Bun.spawnSync(["sh", join(sandbox.shimDir, tool), ...args], { env });
}

function log(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function clearLogs(sandbox: Sandbox) {
  writeFileSync(sandbox.managerLog, "");
  writeFileSync(sandbox.wardenLog, "");
}

function checked(sandbox: Sandbox, tool: string, args: string[]) {
  const result = run(sandbox, tool, args);
  expect(result.exitCode).toBe(0);
}

function inSandbox(body: (sandbox: Sandbox) => void) {
  const sandbox = createSandbox();
  try {
    body(sandbox);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

test("yarn install forms vet supported package arguments and preserve passthrough forms", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "yarn", ["add", "yarn-basic"]);
    checked(sandbox, "yarn", ["add", "-D", "yarn-dev"]);
    checked(sandbox, "yarn", ["global", "add", "yarn-global"]);
    checked(sandbox, "yarn", ["dlx", "yarn-tool"]);
    checked(sandbox, "yarn", []);
    expect(log(sandbox.wardenLog)).toBe("check\nyarn-basic\n--json\ncheck\nyarn-dev\n--json\n");
    expect(log(sandbox.managerLog)).toBe(
      "yarn\tadd\tyarn-basic\nyarn\tadd\t-D\tyarn-dev\nyarn\tglobal\tadd\tyarn-global\nyarn\tdlx\tyarn-tool\nyarn\n",
    );
  }));

test("pnpm install and dlx forms vet their package arguments", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "pnpm", ["add", "pnpm-add"]);
    checked(sandbox, "pnpm", ["install", "pnpm-install"]);
    checked(sandbox, "pnpm", ["i", "pnpm-short"]);
    checked(sandbox, "pnpm", ["add", "-g", "pnpm-global"]);
    checked(sandbox, "pnpm", ["dlx", "pnpm-tool"]);
    expect(log(sandbox.wardenLog)).toBe(
      "check\npnpm-add\n--json\ncheck\npnpm-install\n--json\ncheck\npnpm-short\n--json\ncheck\npnpm-global\n--json\ncheck\npnpm-tool\n--json\n",
    );
  }));

test("bun install and bunx forms vet while the bun a alias currently passes through", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "bun", ["add", "bun-add"]);
    checked(sandbox, "bun", ["install", "bun-install"]);
    checked(sandbox, "bun", ["a", "bun-alias"]);
    checked(sandbox, "bunx", ["bun-tool"]);
    expect(log(sandbox.wardenLog)).toBe(
      "check\nbun-add\n--json\ncheck\nbun-install\n--json\ncheck\nbun-tool\n--json\n",
    );
    expect(log(sandbox.managerLog)).toContain("bun\ta\tbun-alias\n");
  }));

test("npm install and npx forms preserve specs, scopes, flags, and package ordering", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["i", "npm-short"]);
    checked(sandbox, "npm", ["install", "-g", "npm-global"]);
    checked(sandbox, "npm", ["install", "--save-dev", "npm-dev"]);
    checked(sandbox, "npm", ["exec", "npm-exec-tool"]);
    checked(sandbox, "npx", ["-p", "npx-package", "command"]);
    checked(sandbox, "npm", [
      "install",
      "first@1.2.3",
      "--registry",
      "registry.test",
      "tagged@latest",
      "--save-dev",
      "@scope/pkg",
    ]);
    expect(log(sandbox.wardenLog)).toBe(
      "check\nnpm-short\n--json\ncheck\nnpm-global\n--json\ncheck\nnpm-dev\n--json\ncheck\nnpx-package\n--json\ncheck\nfirst@1.2.3\n--json\ncheck\ntagged@latest\n--json\ncheck\n@scope/pkg\n--json\n",
    );
    expect(log(sandbox.managerLog)).toContain("npm\texec\tnpm-exec-tool\n");
  }));

test("lockfile-only npm, pnpm, and yarn installs pass through without vetting", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install"]);
    checked(sandbox, "pnpm", ["install"]);
    checked(sandbox, "yarn", []);
    expect(log(sandbox.wardenLog)).toBe("");
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\npnpm\tinstall\nyarn\n");
  }));

test("block verdicts stop every supported manager install and exec path", () =>
  inSandbox((sandbox) => {
    const cases: Array<[string, string[]]> = [
      ["npm", ["install", "danger"]],
      ["pnpm", ["add", "danger"]],
      ["yarn", ["add", "danger"]],
      ["bun", ["add", "danger"]],
      ["npx", ["danger"]],
      ["bunx", ["danger"]],
      ["pnpm", ["dlx", "danger"]],
    ];
    for (const [tool, args] of cases) {
      clearLogs(sandbox);
      const result = run(sandbox, tool, args, {
        WARDEN_EXIT: "20",
        WARDEN_VERDICT: "block",
      });
      expect(result.exitCode).toBe(20);
      expect(log(sandbox.managerLog)).toBe("");
    }
  }));

test("warn verdicts proceed through every supported manager install and exec path", () =>
  inSandbox((sandbox) => {
    const cases: Array<[string, string[]]> = [
      ["npm", ["install", "caution"]],
      ["pnpm", ["add", "caution"]],
      ["yarn", ["add", "caution"]],
      ["bun", ["add", "caution"]],
      ["npx", ["caution"]],
      ["bunx", ["caution"]],
      ["pnpm", ["dlx", "caution"]],
    ];
    for (const [tool, args] of cases) {
      clearLogs(sandbox);
      const result = run(sandbox, tool, args, {
        WARDEN_EXIT: "10",
        WARDEN_VERDICT: "warn",
      });
      expect(result.exitCode).toBe(0);
      expect(log(sandbox.managerLog)).not.toBe("");
    }
  }));

test("log mode observes every supported manager without blocking and records verdicts", () =>
  inSandbox((sandbox) => {
    writeFileSync(
      join(sandbox.home, ".warden", "config.json"),
      '{"mode":"log","intercept":{"install":true,"exec":true}}\n',
    );
    const cases: Array<[string, string[]]> = [
      ["npm", ["install", "observed"]],
      ["pnpm", ["add", "observed"]],
      ["yarn", ["add", "observed"]],
      ["bun", ["add", "observed"]],
      ["npx", ["observed"]],
      ["bunx", ["observed"]],
      ["pnpm", ["dlx", "observed"]],
    ];
    for (const [tool, args] of cases) {
      const result = run(sandbox, tool, args, {
        WARDEN_EXIT: "20",
        WARDEN_VERDICT: "block",
      });
      expect(result.exitCode).toBe(0);
    }
    expect(log(sandbox.managerLog).trim().split("\n")).toHaveLength(cases.length);
    expect(
      log(join(sandbox.home, ".warden", "log.jsonl"))
        .trim()
        .split("\n"),
    ).toHaveLength(cases.length);
  }));

test("real manager exit codes propagate through allow and passthrough paths", () =>
  inSandbox((sandbox) => {
    const allowCases: Array<[string, string[]]> = [
      ["npm", ["install", "allowed"]],
      ["pnpm", ["add", "allowed"]],
      ["yarn", ["add", "allowed"]],
      ["bun", ["add", "allowed"]],
      ["npx", ["allowed"]],
      ["bunx", ["allowed"]],
    ];
    for (const [tool, args] of allowCases) {
      clearLogs(sandbox);
      const result = run(sandbox, tool, args, { MANAGER_EXIT: "41" });
      expect(result.exitCode).toBe(41);
      expect(log(sandbox.wardenLog)).toContain("allowed\n");
    }
    const passthroughCases: Array<[string, string[]]> = [
      ["npm", ["run", "build"]],
      ["pnpm", ["remove", "old"]],
      ["yarn", ["info", "pkg"]],
      ["bun", ["run", "build"]],
    ];
    for (const [tool, args] of passthroughCases) {
      clearLogs(sandbox);
      const result = run(sandbox, tool, args, { MANAGER_EXIT: "42" });
      expect(result.exitCode).toBe(42);
      expect(log(sandbox.wardenLog)).toBe("");
    }
  }));
