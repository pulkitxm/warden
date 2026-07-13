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
  const root = mkdtempSync(join(tmpdir(), "warden-shim-"));
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
exit 0
`;
  const wardenStub = `#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg" >> "$WARDEN_LOG"; done
printf '{"verdict":"%s"}\n' "\${WARDEN_VERDICT:-allow}"
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
  return { root, home, shimDir, binDir, realDir, managerLog, wardenLog, wardenStub };
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
    ...extraEnv,
  });
  return Bun.spawnSync(["sh", join(sandbox.shimDir, tool), ...args], {
    env,
  });
}

function text(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function log(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function checked(sandbox: Sandbox, tool: string, args: string[], extraEnv = {}) {
  const result = run(sandbox, tool, args, extraEnv);
  expect(result.exitCode).toBe(0);
  return result;
}

function inSandbox(body: (sandbox: Sandbox) => void) {
  const sandbox = createSandbox();
  try {
    body(sandbox);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

test("npm install allow vets the package and preserves argv", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install", "left-pad"]);
    expect(log(sandbox.wardenLog)).toBe("check\nleft-pad\n--json\n");
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tleft-pad\n");
  }));

test("npm install block exits 20 without invoking npm", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "danger"], {
      WARDEN_EXIT: "20",
      WARDEN_VERDICT: "block",
    });
    expect(result.exitCode).toBe(20);
    expect(text(result.stderr)).toContain('"verdict":"block"');
    expect(log(sandbox.managerLog)).toBe("");
  }));

test("allow-risky is sent to warden and removed before npm runs", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install", "danger", "--allow-risky"], {
      WARDEN_EXIT: "0",
      WARDEN_VERDICT: "allow",
    });
    expect(log(sandbox.wardenLog)).toBe("check\ndanger\n--json\n--allow-risky\n");
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tdanger\n");
  }));

test("warn verdict prints the verdict and proceeds", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "uncertain"], {
      WARDEN_EXIT: "10",
      WARDEN_VERDICT: "warn",
    });
    expect(result.exitCode).toBe(0);
    expect(text(result.stderr)).toContain('"verdict":"warn"');
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tuncertain\n");
  }));

test("npx and bunx vet execution packages and stop on block", () =>
  inSandbox((sandbox) => {
    for (const tool of ["npx", "bunx"]) {
      writeFileSync(sandbox.wardenLog, "");
      writeFileSync(sandbox.managerLog, "");
      const result = run(sandbox, tool, ["--yes", "danger", "arg"], {
        WARDEN_EXIT: "20",
        WARDEN_VERDICT: "block",
      });
      expect(result.exitCode).toBe(20);
      expect(log(sandbox.wardenLog)).toContain("danger\n");
      expect(log(sandbox.managerLog)).toBe("");
    }
  }));

test("non-install npm verbs pass through without vetting", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["run", "build"]);
    checked(sandbox, "npm", ["audit"]);
    expect(log(sandbox.wardenLog)).toBe("");
    expect(log(sandbox.managerLog)).toBe("npm\trun\tbuild\nnpm\taudit\n");
  }));

test("bare invocation passes through", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", []);
    expect(log(sandbox.wardenLog)).toBe("");
    expect(log(sandbox.managerLog)).toBe("npm\n");
  }));

test("install interception false passes installs through", () =>
  inSandbox((sandbox) => {
    writeFileSync(
      join(sandbox.home, ".warden", "config.json"),
      '{"intercept":{"install":false,"exec":true}}\n',
    );
    checked(sandbox, "npm", ["install", "danger"]);
    expect(log(sandbox.wardenLog)).toBe("");
    expect(log(sandbox.managerLog)).toContain("npm\tinstall\tdanger\n");
  }));

test("exec interception false skips npx but install interception remains active", () =>
  inSandbox((sandbox) => {
    writeFileSync(
      join(sandbox.home, ".warden", "config.json"),
      '{"intercept":{"install":true,"exec":false}}\n',
    );
    checked(sandbox, "npx", ["danger"]);
    checked(sandbox, "npm", ["install", "safe"]);
    expect(log(sandbox.wardenLog)).toBe("check\nsafe\n--json\n");
    expect(log(sandbox.managerLog)).toBe("npx\tdanger\nnpm\tinstall\tsafe\n");
  }));

test("missing and incomplete config use interception defaults", () =>
  inSandbox((sandbox) => {
    rmSync(join(sandbox.home, ".warden", "config.json"));
    checked(sandbox, "npm", ["install", "first"]);
    writeFileSync(join(sandbox.home, ".warden", "config.json"), "{}\n");
    checked(sandbox, "npx", ["second"]);
    expect(log(sandbox.wardenLog)).toContain("first\n");
    expect(log(sandbox.wardenLog)).toContain("second\n");
  }));

test("missing real binary reports a clear error", () =>
  inSandbox((sandbox) => {
    rmSync(join(sandbox.realDir, "npm"));
    const result = run(sandbox, "npm", ["install", "x"]);
    expect(result.exitCode).toBe(127);
    expect(text(result.stderr)).toContain("real npm executable not found");
  }));

test("warden falls back to PATH and reports clearly when absent everywhere", () =>
  inSandbox((sandbox) => {
    rmSync(join(sandbox.binDir, "warden"));
    executable(join(sandbox.realDir, "warden"), sandbox.wardenStub);
    checked(sandbox, "npm", ["install", "path-warden"]);
    expect(log(sandbox.wardenLog)).toContain("path-warden\n");
    rmSync(join(sandbox.realDir, "warden"));
    const result = run(sandbox, "npm", ["install", "missing"]);
    expect(result.exitCode).toBe(127);
    expect(text(result.stderr)).toContain("warden: executable not found");
  }));

test("analysis error exit 30 blocks execution and preserves the status", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "unknown"], {
      WARDEN_EXIT: "30",
      WARDEN_VERDICT: "error",
    });
    expect(result.exitCode).toBe(30);
    expect(text(result.stderr)).toContain('"verdict":"error"');
    expect(log(sandbox.managerLog)).toBe("");
  }));

test("multiple packages are each vetted before one identical install", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install", "one", "two@3", "@scope/four"]);
    expect(log(sandbox.wardenLog)).toBe(
      "check\none\n--json\ncheck\ntwo@3\n--json\ncheck\n@scope/four\n--json\n",
    );
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tone\ttwo@3\t@scope/four\n");
  }));

test("install option values and non-registry specs are not vetted", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", [
      "install",
      "--registry",
      "registry.test",
      "--flag",
      "./local",
      "../parent",
      "/absolute",
      "file:archive",
      "git:repo",
      "http://example.test/a",
      "https://example.test/b",
      "package",
    ]);
    expect(log(sandbox.wardenLog)).toBe("check\npackage\n--json\n");
  }));

test("exec package flags, ignored flags, and empty package lists are handled", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npx", ["--yes", "--package", "first", "ignored"]);
    checked(sandbox, "bunx", ["-p", "second"]);
    checked(sandbox, "npx", ["--yes"]);
    expect(log(sandbox.wardenLog)).toBe("check\nfirst\n--json\ncheck\nsecond\n--json\n");
  }));

test("pnpm dlx removes its verb before exec vetting", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "pnpm", ["dlx", "--silent", "tool-package"]);
    expect(log(sandbox.wardenLog)).toBe("check\ntool-package\n--json\n");
    expect(log(sandbox.managerLog)).toBe("pnpm\tdlx\t--silent\ttool-package\n");
  }));

test("all install manager and verb patterns route through vetting", () =>
  inSandbox((sandbox) => {
    for (const tool of ["npm", "pnpm", "yarn", "bun"]) {
      for (const verb of ["install", "i", "add", "update"]) {
        checked(sandbox, tool, [verb, `${tool}-${verb}`]);
      }
    }
    expect(log(sandbox.wardenLog).split("--json\n").length - 1).toBe(16);
  }));

test("empty verdict output covers silent warning and block paths", () =>
  inSandbox((sandbox) => {
    const silentWarden = `#!/bin/sh
exit "\${WARDEN_EXIT:-0}"
`;
    executable(join(sandbox.binDir, "warden"), silentWarden);
    const warning = run(sandbox, "npm", ["install", "warn"], { WARDEN_EXIT: "10" });
    expect(warning.exitCode).toBe(0);
    expect(text(warning.stderr)).toBe("");
    const block = run(sandbox, "npm", ["install", "block"], { WARDEN_EXIT: "20" });
    expect(block.exitCode).toBe(20);
    expect(text(block.stderr)).toBe("");
  }));

test("log mode records every verdict and never blocks the manager", () =>
  inSandbox((sandbox) => {
    writeFileSync(
      join(sandbox.home, ".warden", "config.json"),
      '{"mode":"log","intercept":{"install":true,"exec":true}}\n',
    );
    const result = run(sandbox, "npm", ["install", "danger"], {
      WARDEN_EXIT: "20",
      WARDEN_VERDICT: "block",
    });
    expect(result.exitCode).toBe(0);
    expect(text(result.stderr)).toBe("");
    expect(log(join(sandbox.home, ".warden", "log.jsonl"))).toBe('{"verdict":"block"}\n');
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tdanger\n");
  }));
