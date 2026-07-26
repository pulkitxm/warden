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
import { type Manager, planCommand } from "../../src/shim/grammar.ts";

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
if [ "$1" = "shim-transaction" ]; then
  [ -n "$WARDEN_TRANSACTION_NOISE" ] && printf '%s\\n' "$WARDEN_TRANSACTION_NOISE" >&2
  if [ -n "$WARDEN_TRANSACTION" ]; then
    printf '%s
' "$WARDEN_TRANSACTION"
  else
    printf '{"decision":"allow","exit":0,"pendingScripts":[],"reasons":[]}
'
  fi
  exit 0
fi
if [ "$1" = "shim-plan" ]; then
  printf '%s\n' "$WARDEN_PLAN"
  exit 0
fi
if [ "$1" = "shim-transaction" ]; then
  if [ -n "$WARDEN_TRANSACTION" ]; then
    printf '%s
' "$WARDEN_TRANSACTION"
  else
    printf '{"decision":"allow","exit":0,"pendingScripts":[],"reasons":[]}
'
  fi
  exit 0
fi
for arg in "$@"; do printf '%s\n' "$arg" >> "$WARDEN_LOG"; done
case " $* " in
  *" --json "*) printf '{"schema_version":"1.0.0","verdict":"%s"}\n' "\${WARDEN_VERDICT:-allow}" ;;
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
    WARDEN_PLAN: JSON.stringify(planCommand(tool as Manager, args)),
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
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tleft-pad\t--ignore-scripts\n");
  }));

test("npm install block exits 20 without invoking npm", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "danger"], {
      WARDEN_EXIT: "20",
      WARDEN_VERDICT: "block",
    });
    expect(result.exitCode).toBe(20);
    expect(text(result.stderr)).toContain("HUMAN VERDICT block");
    expect(text(result.stderr)).toContain("warden: blocked danger; override with --allow-risky");
    expect(text(result.stderr)).not.toContain("schema_version");
    expect(log(sandbox.managerLog)).toBe("");
  }));

test("allow-risky is sent to warden and removed before npm runs", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install", "danger", "--allow-risky"], {
      WARDEN_EXIT: "0",
      WARDEN_VERDICT: "allow",
    });
    expect(log(sandbox.wardenLog)).toBe("check\ndanger\n--json\n--allow-risky\n");
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tdanger\t--ignore-scripts\n");
  }));

test("warn verdict prints the verdict and proceeds", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "uncertain"], {
      WARDEN_EXIT: "10",
      WARDEN_VERDICT: "warn",
    });
    expect(result.exitCode).toBe(0);
    expect(text(result.stderr)).toContain("HUMAN VERDICT warn");
    expect(text(result.stderr)).not.toContain("schema_version");
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tuncertain\t--ignore-scripts\n");
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
    expect(log(sandbox.managerLog)).toBe("npx\tdanger\nnpm\tinstall\tsafe\t--ignore-scripts\n");
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
    expect(log(sandbox.managerLog)).toBe(
      "npm\tinstall\tone\ttwo@3\t@scope/four\t--ignore-scripts\n",
    );
  }));

test("a git, url, or local spec is blocked rather than silently skipped", () =>
  inSandbox((sandbox) => {
    for (const spec of [
      "./local",
      "../parent",
      "/absolute",
      "file:archive",
      "git:repo",
      "http://example.test/a",
      "https://example.test/b",
    ]) {
      writeFileSync(sandbox.managerLog, "");
      const result = run(sandbox, "npm", ["install", spec]);
      expect(result.exitCode).toBe(20);
      expect(text(result.stderr)).toContain("no registry provenance");
      expect(log(sandbox.managerLog)).toBe("");
    }
  }));

test("--allow-risky permits a reviewed non-registry source", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "git:repo", "--allow-risky"]);
    expect(result.exitCode).toBe(0);
    expect(log(sandbox.managerLog)).toContain("npm\tinstall\tgit:repo");
  }));

test("option values are never mistaken for package specs", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install", "--registry", "registry.test", "--flag", "package"]);
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

test("every install verb the grammar mediates routes through vetting", () =>
  inSandbox((sandbox) => {
    const cases = (["npm", "pnpm", "yarn", "bun"] as const).flatMap((tool) =>
      ["install", "i", "add", "update", "up", "upgrade"]
        .filter((verb) => planCommand(tool, [verb, "x"]).kind === "install")
        .map((verb) => [tool, verb] as const),
    );
    expect(cases.length).toBeGreaterThan(12);
    for (const [tool, verb] of cases) {
      checked(sandbox, tool, [verb, `${tool}-${verb}`]);
    }
    expect(log(sandbox.wardenLog).split("--json\n").length - 1).toBe(cases.length);
  }));

test("every mediated install delegates with the manager's script suppression", () =>
  inSandbox((sandbox) => {
    for (const tool of ["npm", "pnpm"] as const) {
      writeFileSync(sandbox.managerLog, "");
      checked(sandbox, tool, ["install", "pkg"]);
      expect(log(sandbox.managerLog)).toContain("--ignore-scripts");
    }
  }));

test("npm ci is mediated and audits the lockfile before delegating", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["ci"]);
    expect(log(sandbox.wardenLog)).toContain("check");
    expect(log(sandbox.wardenLog)).toContain("lockfile");
    expect(log(sandbox.managerLog)).toContain("npm\tci\t--ignore-scripts");
  }));

test("a no-argument install audits the lockfile as a graph transaction", () =>
  inSandbox((sandbox) => {
    checked(sandbox, "npm", ["install"]);
    expect(log(sandbox.wardenLog)).toContain("lockfile");
  }));

test("passthrough commands never reach warden", () =>
  inSandbox((sandbox) => {
    for (const argv of [["run", "build"], ["test"], ["publish"]]) {
      checked(sandbox, "npm", argv);
    }
    expect(log(sandbox.wardenLog)).toBe("");
  }));

test("empty verdict output covers silent warning and block paths", () =>
  inSandbox((sandbox) => {
    const silentWarden = `#!/bin/sh
if [ "$1" = "shim-transaction" ]; then
  if [ -n "$WARDEN_TRANSACTION" ]; then
    printf '%s
' "$WARDEN_TRANSACTION"
  else
    printf '{"decision":"allow","exit":0,"pendingScripts":[],"reasons":[]}
'
  fi
  exit 0
fi
if [ "$1" = "shim-plan" ]; then
  printf '%s\n' "$WARDEN_PLAN"
  exit 0
fi
exit "\${WARDEN_EXIT:-0}"
`;
    executable(join(sandbox.binDir, "warden"), silentWarden);
    const warning = run(sandbox, "npm", ["install", "warn"], { WARDEN_EXIT: "10" });
    expect(warning.exitCode).toBe(0);
    expect(text(warning.stderr)).toBe("");
    const block = run(sandbox, "npm", ["install", "block"], { WARDEN_EXIT: "20" });
    expect(block.exitCode).toBe(20);
    expect(text(block.stderr)).toContain("warden: blocked block; override with --allow-risky");
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
    expect(log(join(sandbox.home, ".warden", "log.jsonl"))).toBe(
      '{"schema_version":"1.0.0","verdict":"block"}\n',
    );
    expect(log(sandbox.managerLog)).toBe("npm\tinstall\tdanger\t--ignore-scripts\n");
  }));

const blockedTransaction = JSON.stringify({
  decision: "block",
  exit: 20,
  planId: "wtxn_test",
  pendingScripts: [],
  reasons: ["byte-utils@2.0.0: known malicious release"],
});

const approvalTransaction = JSON.stringify({
  decision: "needs_approval",
  exit: 10,
  planId: "wtxn_test",
  pendingScripts: ["fast-jwt@5.0.6 postinstall"],
  reasons: ["fast-jwt@5.0.6 has a postinstall script"],
});

test("an install is gated on the whole prospective graph, not only the typed package", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "left-pad"], {
      WARDEN_TRANSACTION: blockedTransaction,
    });
    expect(result.exitCode).toBe(20);
    const err = text(result.stderr);
    expect(err).toContain("blocked on the whole prospective graph");
    expect(err).toContain("byte-utils@2.0.0");
    expect(log(sandbox.managerLog)).toBe("");
  }));

test("the graph gate does not swallow what warden reports while it runs", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "left-pad"], {
      WARDEN_TRANSACTION_NOISE: "resolving the prospective dependency graph",
    });
    expect(result.exitCode).toBe(0);
    expect(text(result.stderr)).toContain("resolving the prospective dependency graph");
  }));

test("a blocked graph names the plan command that shows the full picture", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "left-pad"], {
      WARDEN_TRANSACTION: blockedTransaction,
    });
    expect(text(result.stderr)).toContain("warden plan -- npm install left-pad");
  }));

test("--allow-risky overrides a blocked graph and the install proceeds", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "left-pad", "--allow-risky"], {
      WARDEN_TRANSACTION: blockedTransaction,
    });
    expect(result.exitCode).toBe(0);
    expect(log(sandbox.managerLog)).toContain("left-pad");
  }));

test("a transitive install script is named with the exact approval command", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "@fastify/jwt"], {
      WARDEN_TRANSACTION: approvalTransaction,
    });
    expect(result.exitCode).toBe(0);
    const err = text(result.stderr);
    expect(err).toContain("install scripts new to this graph are suppressed and will not run");
    expect(err).toContain("warden approve-script fast-jwt@5.0.6 --hook postinstall");
  }));

test("an install whose scripts need approval still installs, with scripts suppressed", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "@fastify/jwt"], {
      WARDEN_TRANSACTION: approvalTransaction,
    });
    expect(result.exitCode).toBe(0);
    expect(log(sandbox.managerLog)).toContain("--ignore-scripts");
  }));

test("an exec command is not put through the transaction gate", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npx", ["create-vite"], {
      WARDEN_TRANSACTION: blockedTransaction,
    });
    expect(result.exitCode).toBe(0);
  }));

test("log mode records without ever blocking on the transaction gate", () =>
  inSandbox((sandbox) => {
    writeFileSync(
      join(sandbox.home, ".warden", "config.json"),
      '{"mode":"log","intercept":{"install":true,"exec":true}}\n',
    );
    const result = run(sandbox, "npm", ["install", "left-pad"], {
      WARDEN_TRANSACTION: blockedTransaction,
    });
    expect(result.exitCode).toBe(0);
    expect(log(sandbox.managerLog)).toContain("left-pad");
  }));

test("a gate that returns nothing does not wedge the install", () =>
  inSandbox((sandbox) => {
    const result = run(sandbox, "npm", ["install", "left-pad"], { WARDEN_TRANSACTION: "" });
    expect(result.exitCode).toBe(0);
    expect(log(sandbox.managerLog)).toContain("left-pad");
  }));
