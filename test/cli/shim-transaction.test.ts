import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { ShimTransaction } from "../../src/cli/commands/shim-transaction.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { Verdict } from "../../src/schema.ts";

const CWD = "/repo";

const PACKUMENTS: Record<string, unknown> = {
  "left-pad": {
    name: "left-pad",
    "dist-tags": { latest: "1.3.0" },
    versions: {
      "1.3.0": { version: "1.3.0", dist: { tarball: "t", integrity: "sha512-lp" } },
    },
  },
  chalk: {
    name: "chalk",
    "dist-tags": { latest: "5.3.0" },
    versions: {
      "5.3.0": {
        version: "5.3.0",
        dependencies: { "ansi-styles": "1.0.0" },
        dist: { tarball: "t", integrity: "sha512-ck" },
      },
    },
  },
  "ansi-styles": {
    name: "ansi-styles",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        version: "1.0.0",
        scripts: { postinstall: "node build.js" },
        dist: { tarball: "t", integrity: "sha512-as" },
      },
    },
  },
};

let server: ReturnType<typeof Bun.serve>;
const saved = process.env.WNPM_REGISTRY;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const packument = PACKUMENTS[name];
      return packument ? Response.json(packument) : new Response("nope", { status: 404 });
    },
  });
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (saved === undefined) delete process.env.WNPM_REGISTRY;
  else process.env.WNPM_REGISTRY = saved;
});

function makeDeps(files: Record<string, string> = {}, verdicts: Record<string, string> = {}) {
  const out: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => CWD,
    stdout: (s) => out.push(s),
    stderr: () => undefined,
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    which: () => null,
    check: (spec) => {
      const name = spec.split("@").filter(Boolean)[0] as string;
      const level = (verdicts[name] ?? "allow") as Verdict["verdict"];
      return Promise.resolve({
        schema_version: 1,
        package: name,
        version: "1.0.0",
        integrity: "sha512-x",
        verdict: level,
        risk_score: level === "block" ? 90 : 0,
        categories: level === "block" ? ["known_malware"] : [],
        summary: level === "block" ? "known malicious release" : "no findings",
        evidence: [],
        analyzer_version: "test",
        source: "heuristics",
      } satisfies Verdict);
    },
  };
  return { deps, out };
}

const manifest = (deps: Record<string, string> = {}) =>
  JSON.stringify({ name: "app", dependencies: deps });

const gate = (out: string[]) => JSON.parse(out.join("")) as ShimTransaction;

test("the gate always exits 0, because the shell reads the decision from the payload", async () => {
  const { deps } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  expect(await runWarden(["shim-transaction", "npm", "install", "left-pad"], deps)).toBe(0);
});

test("a clean install is allowed and reports what would enter the graph", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npm", "install", "left-pad"], deps);
  const result = gate(out);
  expect(result.decision).toBe("allow");
  expect(result.exit).toBe(0);
  expect(result.added).toBe(1);
  expect(result.planId).toStartWith("wtxn_");
});

test("a malicious transitive package blocks the intercepted install with exit 20", async () => {
  const { deps, out } = makeDeps(
    { [join(CWD, "package.json")]: manifest() },
    { "ansi-styles": "block" },
  );
  await runWarden(["shim-transaction", "npm", "install", "chalk"], deps);
  const result = gate(out);
  expect(result.decision).toBe("block");
  expect(result.exit).toBe(20);
  expect(result.reasons.join(" ")).toContain("ansi-styles");
});

test("a transitive install script is surfaced with the package and hook the shell should name", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npm", "install", "chalk"], deps);
  const result = gate(out);
  expect(result.decision).toBe("needs_approval");
  expect(result.exit).toBe(10);
  expect(result.pendingScripts).toEqual(["ansi-styles@1.0.0 postinstall"]);
});

test("an exec command is skipped, because it installs nothing into the graph", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npx", "create-vite"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("a rebuild is skipped, because the graph does not change", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npm", "rebuild"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("a passthrough command is skipped", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npm", "run", "build"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("an unknown tool is skipped rather than guessed at", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["shim-transaction", "make", "install"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("no tool at all is skipped", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["shim-transaction"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("a frozen install is gated as a graph transaction over the whole manifest", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package.json")]: manifest({ chalk: "^5.3.0" }),
  });
  await runWarden(["shim-transaction", "npm", "ci"], deps);
  const result = gate(out);
  expect(result.decision).toBe("needs_approval");
  expect(result.added).toBe(2);
});

test("a project with nothing to install is skipped rather than blocked", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["shim-transaction", "npm", "install"], deps);
  expect(gate(out).decision).toBe("skipped");
});

test("an unplannable transaction fails closed rather than allowing the install", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  deps.exists = () => {
    throw new Error("EACCES");
  };
  await runWarden(["shim-transaction", "npm", "install", "left-pad"], deps);
  const result = gate(out);
  expect(result.decision).toBe("block");
  expect(result.exit).toBe(30);
  expect(result.reasons.join(" ")).toContain("could not be planned");
});

test("the payload stays small enough for a shell to parse with sed", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["shim-transaction", "npm", "install", "chalk"], deps);
  const line = out.join("").trim();
  expect(line.split("\n")).toHaveLength(1);
  expect(gate(out).reasons.length).toBeLessThanOrEqual(6);
});

test("an already-installed package is not re-planned as an addition", async () => {
  const lock = JSON.stringify({
    packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
  });
  const { deps, out } = makeDeps({
    [join(CWD, "package.json")]: manifest({ "left-pad": "^1.3.0" }),
    [join(CWD, "package-lock.json")]: lock,
  });
  await runWarden(["shim-transaction", "npm", "install", "left-pad"], deps);
  const result = gate(out);
  expect(result.added).toBe(0);
  expect(result.decision).toBe("allow");
});
