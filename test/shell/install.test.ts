import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installScript = join(import.meta.dir, "../../install.sh");
const shimScript = join(import.meta.dir, "../../scripts/shim.sh");
const pathLine = 'export PATH="$HOME/.warden/shims:$HOME/.warden/bin:$PATH"';
const managerNames = ["npm", "bun", "npx", "bunx", "pnpm", "yarn"];
const toolNames = [
  "awk",
  "cat",
  "chmod",
  "cp",
  "grep",
  "gzip",
  "head",
  "ln",
  "mkdir",
  "mktemp",
  "mv",
  "readlink",
  "rm",
  "sh",
  "tar",
  "touch",
];

let fixtures = "";
let source = "";
let asset = "";

type Sandbox = ReturnType<typeof createSandbox>;

function executable(path: string, body: string) {
  writeFileSync(path, body, { mode: 0o755 });
}

function commandPath(name: string) {
  const path = Bun.which(name);
  if (!path) throw new Error(`missing required test command: ${name}`);
  return path;
}

function spawn(command: string, args: string[], cwd?: string) {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env: { HOME: fixtures || tmpdir(), PATH: "/bin:/usr/bin:/sbin" },
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}

beforeAll(() => {
  fixtures = mkdtempSync(join(tmpdir(), "warden-install-fixtures-"));
  source = join(fixtures, "source");
  const dist = join(source, "dist");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(source, "scripts"), { recursive: true });
  const binary = `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf '1.2.3\n'; fi
exit 0
`;
  for (const name of ["warden", "wnpm", "wnpx"]) executable(join(dist, name), binary);
  copyFileSync(installScript, join(source, "install.sh"));
  copyFileSync(shimScript, join(source, "scripts", "shim.sh"));
  asset = join(fixtures, "warden-linux-x64.tar.gz");
  spawn(commandPath("tar"), ["-czf", asset, "warden", "wnpm", "wnpx"], dist);
  spawn(commandPath("tar"), ["-czf", join(fixtures, "missing.tar.gz"), "warden", "wnpm"], dist);
  const checksumTool = Bun.which("shasum") ?? Bun.which("sha256sum");
  if (!checksumTool) throw new Error("missing checksum utility");
  const checksumArgs = checksumTool.endsWith("shasum") ? ["-a", "256", asset] : [asset];
  const hash = spawn(checksumTool, checksumArgs).split(/[ \t]/)[0];
  writeFileSync(join(fixtures, "sha256sums.txt"), `${hash}  warden-linux-x64.tar.gz\n`);
  writeFileSync(join(fixtures, "missing-sha256sums.txt"), `${hash}  another-asset.tar.gz\n`);
  writeFileSync(
    join(fixtures, "corrupt-sha256sums.txt"),
    `${"0".repeat(64)}  warden-linux-x64.tar.gz\n`,
  );
});

afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

function createSandbox(presentManagers: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "warden-install-"));
  const home = join(root, "home");
  const temp = join(root, "tmp");
  const stubs = join(root, "stubs");
  const tools = join(root, "tools");
  mkdirSync(home);
  mkdirSync(temp);
  mkdirSync(stubs);
  mkdirSync(tools);
  for (const name of toolNames) symlinkSync(commandPath(name), join(tools, name));
  const manager = `#!/bin/sh
if [ "\${MANAGER_EXIT:-0}" -ne 0 ]; then exit "$MANAGER_EXIT"; fi
if [ "\${1:-}" = "--version" ]; then printf '%s\n' "\${0##*/}-9.9.9"; fi
exit "\${MANAGER_EXIT:-0}"
`;
  for (const name of managerNames) executable(join(stubs, name), manager);
  for (const name of managerNames) {
    if (!presentManagers.includes(name)) rmSync(join(stubs, name));
  }
  const uname = `#!/bin/sh
case "\${1:-}" in
  -s) printf '%s\n' "\${FAKE_UNAME_S:-Linux}" ;;
  -m) printf '%s\n' "\${FAKE_UNAME_M:-x86_64}" ;;
esac
`;
  executable(join(stubs, "uname"), uname);
  const curl = `#!/bin/sh
output=
effective=false
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -w) effective=true; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  */latest/download/*) cp "$CURL_TARBALL" "$output" ;;
  */sha256sums.txt) cp "$CURL_SUMS" "$output" ;;
  */scripts/shim.sh) cp "$CURL_SOURCE/scripts/shim.sh" "$output" ;;
  */install.sh) cp "$CURL_SOURCE/install.sh" "$output" ;;
  *) exit 22 ;;
esac
if [ "$effective" = true ]; then printf 'https://github.com/pulkitxm/warden/releases/download/v9.9.9/warden-linux-x64.tar.gz'; fi
`;
  executable(join(stubs, "curl"), curl);
  return { root, home, temp, stubs, tools };
}

function checksumPath(sandbox: Sandbox, kind: "sha256sum" | "shasum") {
  if (kind === "sha256sum") {
    symlinkSync(commandPath("sha256sum"), join(sandbox.stubs, "sha256sum"));
  } else {
    symlinkSync(commandPath("shasum"), join(sandbox.stubs, "shasum"));
  }
}

function run(
  sandbox: Sandbox,
  args: string[] = [],
  options: {
    answer?: string;
    env?: Record<string, string | undefined>;
    local?: boolean;
    path?: string;
  } = {},
) {
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(process.env).map((key) => [key, ""]),
  );
  Object.assign(env, {
    HOME: sandbox.home,
    PATH: options.path ?? `${sandbox.stubs}:${sandbox.tools}`,
    TMPDIR: sandbox.temp,
    FAKE_UNAME_S: "Linux",
    FAKE_UNAME_M: "x86_64",
    CURL_TARBALL: asset,
    CURL_SUMS: join(fixtures, "sha256sums.txt"),
    CURL_SOURCE: source,
  });
  if (options.local !== false) env.WARDEN_INSTALL_SOURCE = source;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) env[key] = "";
    else env[key] = value;
  }
  const input = join(sandbox.root, "stdin");
  writeFileSync(input, options.answer ?? "");
  return Bun.spawnSync(["sh", installScript, ...args], {
    env,
    stdin: Bun.file(input),
  });
}

function text(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function output(result: ReturnType<typeof Bun.spawnSync>) {
  return text(result.stdout ?? new Uint8Array()) + text(result.stderr ?? new Uint8Array());
}

function config(sandbox: Sandbox) {
  return readFileSync(join(sandbox.home, ".warden", "config.json"), "utf8");
}

function inSandbox(presentManagers: string[], body: (sandbox: Sandbox) => void) {
  const sandbox = createSandbox(presentManagers);
  try {
    body(sandbox);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

test("fresh local install copies executable binaries and only present manager shims", () =>
  inSandbox(["npm", "bun", "npx"], (sandbox) => {
    const result = run(sandbox, [], { answer: "\n", env: { SHELL: "/bin/zsh" } });
    expect(result.exitCode).toBe(0);
    for (const name of ["warden", "wnpm", "wnpx"]) {
      const path = join(sandbox.home, ".warden", "bin", name);
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
    }
    expect(existsSync(join(sandbox.home, ".warden", "shims", "npm"))).toBe(true);
    expect(existsSync(join(sandbox.home, ".warden", "shims", "bun"))).toBe(true);
    expect(existsSync(join(sandbox.home, ".warden", "shims", "npx"))).toBe(true);
    expect(existsSync(join(sandbox.home, ".warden", "shims", "pnpm"))).toBe(false);
    expect(config(sandbox)).toContain('"mode": "brief"');
  }));

test("prompt maps empty and garbage to brief, 2 to log, and EOF to brief", () => {
  for (const [answer, mode] of [
    ["\n", "brief"],
    ["2\n", "log"],
    ["garbage\n", "brief"],
    ["", "brief"],
  ]) {
    inSandbox([], (sandbox) => {
      const result = run(sandbox, [], { answer });
      expect(result.exitCode).toBe(0);
      expect(config(sandbox)).toContain(`"mode": "${mode}"`);
    });
  }
});

test("shell selection writes zsh, bash, and unset-shell rc files", () => {
  for (const [shell, rc] of [
    ["/bin/zsh", ".zshrc"],
    ["/bin/bash", ".bashrc"],
    [undefined, ".profile"],
  ] as const) {
    inSandbox([], (sandbox) => {
      const result = run(sandbox, [], { env: { SHELL: shell } });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(sandbox.home, rc), "utf8")).toContain(pathLine);
    });
  }
});

test("second install upgrades without duplicating or replacing config and shims", () =>
  inSandbox(["npm"], (sandbox) => {
    expect(run(sandbox, [], { answer: "2\n", env: { SHELL: "/bin/bash" } }).exitCode).toBe(0);
    const configPath = join(sandbox.home, ".warden", "config.json");
    const shimPath = join(sandbox.home, ".warden", "shims", "npm");
    writeFileSync(configPath, "kept-config\n");
    writeFileSync(shimPath, "kept-shim\n");
    const result = run(sandbox, [], { env: { SHELL: "/bin/bash" } });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("upgrading 1.2.3 -> local");
    expect(readFileSync(configPath, "utf8")).toBe("kept-config\n");
    expect(readFileSync(shimPath, "utf8")).toBe("kept-shim\n");
    const rc = readFileSync(join(sandbox.home, ".bashrc"), "utf8");
    expect(rc.split(pathLine).length - 1).toBe(1);
  }));

test("upgrade uses installed fallback when the old version probe fails", () =>
  inSandbox([], (sandbox) => {
    expect(run(sandbox).exitCode).toBe(0);
    executable(join(sandbox.home, ".warden", "bin", "warden"), "#!/bin/sh\nexit 1\n");
    const result = run(sandbox);
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("upgrading installed -> local");
  }));

test("fresh install recognizes an already configured rc file", () =>
  inSandbox([], (sandbox) => {
    writeFileSync(join(sandbox.home, ".bashrc"), `${pathLine}\n`);
    const result = run(sandbox, [], { env: { SHELL: "/bin/bash" } });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("PATH       already configured");
    expect(readFileSync(join(sandbox.home, ".bashrc"), "utf8")).toBe(`${pathLine}\n`);
  }));

test("uninstall removes owned links, root, and PATH line but preserves user entries", () =>
  inSandbox([], (sandbox) => {
    const localBin = join(sandbox.home, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    const safePath = `${localBin}:${sandbox.stubs}:${sandbox.tools}`;
    expect(
      run(sandbox, [], { answer: "\n", env: { SHELL: "/bin/zsh" }, path: safePath }).exitCode,
    ).toBe(0);
    rmSync(join(localBin, "warden"));
    writeFileSync(join(localBin, "warden"), "user-owned\n");
    rmSync(join(localBin, "wnpm"));
    symlinkSync(join(sandbox.home, "other-wnpm"), join(localBin, "wnpm"));
    writeFileSync(join(sandbox.home, ".zshrc"), `before\n${pathLine}\nafter\n`);
    const result = run(sandbox, ["--uninstall"], {
      env: { SHELL: "/bin/zsh" },
      path: safePath,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(sandbox.home, ".warden"))).toBe(false);
    expect(readFileSync(join(localBin, "warden"), "utf8")).toBe("user-owned\n");
    expect(readlinkSync(join(localBin, "wnpm"))).toBe(join(sandbox.home, "other-wnpm"));
    expect(existsSync(join(localBin, "wnpx"))).toBe(false);
    expect(readFileSync(join(sandbox.home, ".zshrc"), "utf8")).toBe("before\nafter\n");
  }));

test("uninstall tolerates absent root and rc", () =>
  inSandbox([], (sandbox) => {
    const result = run(sandbox, ["--uninstall"], { env: { SHELL: undefined } });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("removed ~/.warden");
  }));

test("uninstall removes a PATH-only rc when grep finds no retained lines", () =>
  inSandbox([], (sandbox) => {
    writeFileSync(join(sandbox.home, ".profile"), `${pathLine}\n`);
    const result = run(sandbox, ["--uninstall"], { env: { SHELL: undefined } });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(sandbox.home, ".profile"), "utf8")).toBe("");
  }));

test("writable HOME local bin receives links and ready message", () =>
  inSandbox([], (sandbox) => {
    const localBin = join(sandbox.home, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    const result = run(sandbox, [], {
      path: `${localBin}:${sandbox.stubs}:${sandbox.tools}`,
    });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("warden is ready in this shell");
    expect(readlinkSync(join(localBin, "warden"))).toBe(
      join(sandbox.home, ".warden", "bin", "warden"),
    );
  }));

test("no writable on-PATH candidate prints export fallback", () =>
  inSandbox([], (sandbox) => {
    const missingCandidate = join(sandbox.home, ".local", "bin");
    const result = run(sandbox, [], {
      path: `${missingCandidate}:${sandbox.stubs}:${sandbox.tools}`,
    });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("to use warden in this shell right now");
    expect(output(result)).toContain(pathLine);
  }));

test("download install verifies with sha256sum and extracts all binaries", () =>
  inSandbox(["npm"], (sandbox) => {
    checksumPath(sandbox, "sha256sum");
    const result = run(sandbox, [], { local: false, answer: "2\n" });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("sha256 verified");
    expect(output(result)).toContain("mode: log");
    for (const name of ["warden", "wnpm", "wnpx"]) {
      expect(existsSync(join(sandbox.home, ".warden", "bin", name))).toBe(true);
    }
  }));

test("download install verifies with shasum fallback", () =>
  inSandbox([], (sandbox) => {
    checksumPath(sandbox, "shasum");
    const hash = readFileSync(join(fixtures, "sha256sums.txt"), "utf8").split(/[ \t]/)[0];
    const sums = join(sandbox.root, "star-sha256sums.txt");
    writeFileSync(sums, `${hash} *warden-linux-x64.tar.gz\n`);
    const result = run(sandbox, [], { local: false, env: { CURL_SUMS: sums } });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("sha256 verified");
  }));

test("download install rejects a corrupted checksum", () =>
  inSandbox([], (sandbox) => {
    checksumPath(sandbox, "shasum");
    const result = run(sandbox, [], {
      local: false,
      env: { CURL_SUMS: join(fixtures, "corrupt-sha256sums.txt") },
    });
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(sandbox.home, ".warden"))).toBe(false);
  }));

test("download install rejects a checksum file without the asset", () =>
  inSandbox([], (sandbox) => {
    checksumPath(sandbox, "shasum");
    const result = run(sandbox, [], {
      local: false,
      env: { CURL_SUMS: join(fixtures, "missing-sha256sums.txt") },
    });
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("checksum missing for warden-linux-x64.tar.gz");
  }));

test("download tarball missing a binary reports source is missing", () =>
  inSandbox([], (sandbox) => {
    checksumPath(sandbox, "shasum");
    const missingAsset = join(fixtures, "missing.tar.gz");
    const checksum = spawn(commandPath("shasum"), ["-a", "256", missingAsset]).split(/[ \t]/)[0];
    const sums = join(sandbox.root, "missing-binary-sums.txt");
    writeFileSync(sums, `${checksum}  warden-linux-x64.tar.gz\n`);
    const result = run(sandbox, [], {
      local: false,
      env: { CURL_TARBALL: missingAsset, CURL_SUMS: sums },
    });
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("source is missing wnpx");
  }));

test("unsupported system and architecture exit with clear errors", () => {
  for (const [env, message] of [
    [{ FAKE_UNAME_S: "Plan9" }, "unsupported system"],
    [{ FAKE_UNAME_M: "mips" }, "unsupported architecture"],
  ] as const) {
    inSandbox([], (sandbox) => {
      const result = run(sandbox, [], { env });
      expect(result.exitCode).toBe(1);
      expect(output(result)).toContain(message);
    });
  }
});

test("supported uname aliases map to expected platform names", () => {
  for (const [system, machine, expected] of [
    ["Darwin", "amd64", "darwin x64"],
    ["Linux", "arm64", "linux arm64"],
    ["Linux", "aarch64", "linux arm64"],
  ]) {
    inSandbox([], (sandbox) => {
      const result = run(sandbox, [], {
        env: { FAKE_UNAME_S: system, FAKE_UNAME_M: machine },
      });
      expect(result.exitCode).toBe(0);
      expect(output(result)).toContain(expected);
    });
  }
});

test("local source missing a binary reports source is missing", () =>
  inSandbox([], (sandbox) => {
    const incomplete = join(sandbox.root, "incomplete-source");
    mkdirSync(join(incomplete, "dist"), { recursive: true });
    copyFileSync(join(source, "dist", "warden"), join(incomplete, "dist", "warden"));
    chmodSync(join(incomplete, "dist", "warden"), 0o755);
    const result = run(sandbox, [], { env: { WARDEN_INSTALL_SOURCE: incomplete } });
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("source is missing wnpm");
  }));

test("manager discovery handles none present and version command failure", () =>
  inSandbox(["npm"], (sandbox) => {
    const result = run(sandbox, [], { env: { MANAGER_EXIT: "1" } });
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("managers   npm  found");
    expect(output(result)).toContain("shims      npm");
  }));
