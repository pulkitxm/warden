import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { PLAN_DIR, renderPlan, specsFromArgv } from "../../src/cli/commands/plan.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { TransactionPlan } from "../../src/graph/plan.ts";
import type { Verdict } from "../../src/schema.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";

const PACKUMENTS: Record<string, unknown> = {
  "left-pad": {
    name: "left-pad",
    "dist-tags": { latest: "1.3.0" },
    versions: {
      "1.3.0": {
        version: "1.3.0",
        dist: { tarball: "https://reg.test/left-pad.tgz", integrity: "sha512-lp" },
      },
    },
  },
  chalk: {
    name: "chalk",
    "dist-tags": { latest: "5.3.0" },
    versions: {
      "5.3.0": {
        version: "5.3.0",
        dependencies: { "ansi-styles": "1.0.0" },
        dist: { tarball: "https://reg.test/chalk.tgz", integrity: "sha512-ck" },
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
        dist: { tarball: "https://reg.test/ansi.tgz", integrity: "sha512-as" },
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
      return packument ? Response.json(packument) : new Response("not found", { status: 404 });
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
  const err: string[] = [];
  const written: Record<string, string> = {};
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => CWD,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    which: () => null,
    mkdir: () => undefined,
    writeFile: (path, data) => {
      written[path] = data;
    },
    check: (spec) => {
      const name = spec.split("@").filter(Boolean)[0] as string;
      const level = (verdicts[name] ?? "allow") as Verdict["verdict"];
      return Promise.resolve({
        schema_version: 1,
        package: name,
        version: spec.split("@").filter(Boolean)[1] ?? "1.0.0",
        integrity: `sha512-${name}`,
        verdict: level,
        risk_score: level === "block" ? 90 : 0,
        categories: level === "block" ? ["known_malware"] : [],
        summary: level === "block" ? "known malware" : "no findings",
        evidence: [],
        analyzer_version: "test",
        source: "heuristics",
      } satisfies Verdict);
    },
  };
  return { deps, out, err, written };
}

const manifest = (deps: Record<string, string> = {}) =>
  JSON.stringify({ name: "app", dependencies: deps });

test("a package name after the manager and verb is what gets planned", () => {
  expect(specsFromArgv(["--", "npm", "install", "left-pad"])).toEqual(["left-pad"]);
  expect(specsFromArgv(["--", "pnpm", "add", "chalk@5"])).toEqual(["chalk@5"]);
  expect(specsFromArgv(["--", "yarn", "add", "a", "b"])).toEqual(["a", "b"]);
});

test("bare package names work without the manager preamble", () => {
  expect(specsFromArgv(["left-pad", "chalk"])).toEqual(["left-pad", "chalk"]);
});

test("flags never become package specs", () => {
  expect(specsFromArgv(["--json", "--", "npm", "install", "left-pad", "--save-dev"])).toEqual([
    "left-pad",
  ]);
});

test("a bare install with no packages plans the manifest instead of nothing", () => {
  expect(specsFromArgv(["--", "npm", "install"])).toEqual([]);
});

test("planning a clean package allows and writes the plan to disk", async () => {
  const { deps, err, written } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  expect(await runWarden(["plan", "--", "npm", "install", "left-pad"], deps)).toBe(0);
  const path = Object.keys(written)[0] as string;
  expect(path).toContain(PLAN_DIR);
  const plan = JSON.parse(written[path] as string) as TransactionPlan;
  expect(plan.decision).toBe("allow");
  expect(plan.direct).toEqual([{ name: "left-pad", range: "latest" }]);
  expect(err.join("")).toContain("WARDEN PLAN");
});

test("--json emits exactly one plan object and no human text", async () => {
  const { deps, out, err } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["plan", "--json", "--", "npm", "install", "left-pad"], deps);
  expect(out).toHaveLength(1);
  const plan = JSON.parse(out[0] as string) as TransactionPlan;
  expect(plan.schema_version).toBe(1);
  expect(plan.plan_id).toStartWith("wtxn_");
  expect(err).toEqual([]);
});

test("a transitive install script turns the decision into needs approval and exits 10", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  expect(await runWarden(["plan", "--json", "--", "npm", "install", "chalk"], deps)).toBe(10);
  const plan = JSON.parse(out[0] as string) as TransactionPlan;
  expect(plan.decision).toBe("needs_approval");
  expect(plan.delta.newScriptSurface.map((entry) => entry.name)).toEqual(["ansi-styles"]);
});

test("a transitive package the user never typed is still vetted and can block, exit 20", async () => {
  const { deps, out } = makeDeps(
    { [join(CWD, "package.json")]: manifest() },
    { "ansi-styles": "block" },
  );
  expect(await runWarden(["plan", "--json", "--", "npm", "install", "chalk"], deps)).toBe(20);
  const plan = JSON.parse(out[0] as string) as TransactionPlan;
  expect(plan.decision).toBe("block");
  expect(plan.reasons.join(" ")).toContain("ansi-styles");
});

test("an existing lockfile keeps unchanged packages out of the analysis", async () => {
  const lock = JSON.stringify({
    packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
  });
  const { deps, out } = makeDeps({
    [join(CWD, "package.json")]: manifest({ "left-pad": "^1.3.0" }),
    [join(CWD, "package-lock.json")]: lock,
  });
  await runWarden(["plan", "--json"], deps);
  const plan = JSON.parse(out[0] as string) as TransactionPlan;
  expect(plan.delta.unchanged).toBe(1);
  expect(plan.coverage.changed).toBe(0);
});

test("planning with nothing to plan is a usage error rather than a false allow", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["plan", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_PLAN_EMPTY");
});

test("an unreachable registry is an analysis error, never an allow", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  const code = await runWarden(["plan", "--json", "--", "npm", "install", "left-pad"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(20);
  expect(JSON.parse(out[0] as string).decision).toBe("block");
});

test("a plan that cannot be written still reports, and says the plan is not on disk", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  deps.writeFile = () => {
    throw new Error("read-only filesystem");
  };
  await runWarden(["plan", "--json", "--", "npm", "install", "left-pad"], deps);
  expect(JSON.parse(out[0] as string).reasons.join(" ")).toContain("could not be written");
});

test("an unreadable project is an error, not an empty plan that allows everything", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  deps.exists = () => {
    throw new Error("EACCES");
  };
  expect(await runWarden(["plan", "--json", "--", "npm", "install", "left-pad"], deps)).toBe(30);
  const error = JSON.parse(out[0] as string).error;
  expect(error.code).toBe("WARDEN_PLAN_ERROR");
  expect(error.reason).toContain("could not be planned");
});

test("--quiet suppresses the human plan", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps({ [join(CWD, "package.json")]: manifest() });
  await runWarden(["plan", "--", "npm", "install", "left-pad"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("the rendered plan leads with the decision and the next action, not a score", () => {
  setColor(false);
  const plan: TransactionPlan = {
    schema_version: 1,
    plan_id: "wtxn_test",
    command: "npm install chalk",
    manager: "npm",
    root: "/repo",
    direct: [{ name: "chalk", range: "latest" }],
    graph_before: "sha256:a",
    graph_after: "sha256:b",
    delta: {
      added: [
        {
          name: "chalk",
          version: "5.3.0",
          direct: true,
          hooks: [],
          newHooks: [],
          deprecated: false,
          platformSpecific: false,
          requiredBy: [],
        },
      ],
      changed: [],
      removed: [],
      unchanged: 12,
      scriptSurface: [],
      newScriptSurface: [],
      platformArtifacts: [],
      deprecatedIntroduced: [],
    },
    artifacts: [
      {
        package: "chalk",
        version: "5.3.0",
        verdict: "allow",
        summary: "no findings",
        categories: [],
      },
    ],
    unresolved: [],
    conflicts: [],
    truncated: false,
    coverage: { analyzed: 1, changed: 1, ratio: 1 },
    decision: "allow",
    reasons: [],
    next_actions: ["warden apply wtxn_test"],
  };
  const text = renderPlan(plan);
  expect(text).toContain("Decision: ALLOW");
  expect(text).toContain("Next action");
  expect(text).toContain("warden apply wtxn_test");
  expect(text).toContain("1 of 1 changed packages analyzed (100%)");
  expect(text).not.toContain("risk");
});

test("a graph transaction with no direct package says so instead of printing an empty list", () => {
  setColor(false);
  const text = renderPlan({
    schema_version: 1,
    plan_id: "wtxn_x",
    command: "npm install",
    manager: "npm",
    root: "/repo",
    direct: [],
    graph_before: "sha256:a",
    graph_after: "sha256:a",
    delta: {
      added: [],
      changed: [],
      removed: [],
      unchanged: 0,
      scriptSurface: [],
      newScriptSurface: [],
      platformArtifacts: [],
      deprecatedIntroduced: [],
    },
    artifacts: [],
    unresolved: [],
    conflicts: [],
    truncated: true,
    coverage: { analyzed: 0, changed: 0, ratio: 1 },
    decision: "needs_approval",
    reasons: Array.from({ length: 12 }, (_, index) => `reason ${index}`),
    next_actions: [],
  });
  expect(text).toContain("graph transaction over the existing manifest");
  expect(text).toContain("and 4 more");
  expect(text).toContain("coverage is incomplete");
});
