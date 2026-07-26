import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { RECEIPT_DIR, renderReceipt } from "../../src/cli/commands/apply.ts";
import { PLAN_DIR } from "../../src/cli/commands/plan.ts";
import { renderVerify, verifyReceipt } from "../../src/cli/commands/verify.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { hashScript } from "../../src/graph/approvals.ts";
import type { TransactionPlan } from "../../src/graph/plan.ts";
import type { TransactionReceipt } from "../../src/graph/receipt.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";
const HOME = "/home/u";
const SCRIPT = "node build.js";
const EMPTY_GRAPH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const PACKUMENT = {
  name: "esbuild",
  "dist-tags": { latest: "0.25.8" },
  versions: {
    "0.25.8": {
      version: "0.25.8",
      scripts: { postinstall: SCRIPT },
      dist: { tarball: "https://reg.test/esbuild.tgz", integrity: "sha512-esbuild" },
    },
    "0.25.9": {
      version: "0.25.9",
      dist: { tarball: "https://reg.test/esbuild9.tgz", integrity: "sha512-esbuild9" },
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
      return name === "esbuild"
        ? Response.json(PACKUMENT)
        : new Response("not found", { status: 404 });
    },
  });
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (saved === undefined) delete process.env.WNPM_REGISTRY;
  else process.env.WNPM_REGISTRY = saved;
});

const scriptChange = {
  name: "esbuild",
  version: "0.25.8",
  direct: true,
  hooks: ["postinstall"],
  newHooks: ["postinstall"],
  deprecated: false,
  platformSpecific: false,
  requiredBy: [],
};

function samplePlan(over: Partial<TransactionPlan> = {}): TransactionPlan {
  return {
    schema_version: 1,
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: "npm",
    root: CWD,
    direct: [{ name: "esbuild", range: "0.25.8" }],
    graph_before: EMPTY_GRAPH,
    graph_after: EMPTY_GRAPH,
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
    artifacts: [
      {
        package: "esbuild",
        version: "0.25.8",
        integrity: "sha512-esbuild",
        verdict: "allow",
        summary: "no findings",
        categories: [],
      },
    ],
    unresolved: [],
    conflicts: [],
    truncated: false,
    resolver: "metadata",
    coverage: { analyzed: 1, changed: 1, ratio: 1 },
    decision: "allow",
    reasons: [],
    next_actions: [],
    ...over,
  };
}

function makeDeps(files: Record<string, string> = {}, exitCode = 0) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const commands: string[][] = [];
  const store = { ...files };
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: HOME,
    cwd: () => CWD,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in store,
    readFile: (path) => {
      if (!(path in store)) throw new Error(`ENOENT ${path}`);
      return store[path] as string;
    },
    mkdir: () => undefined,
    writeFile: (path, data) => {
      written[path] = data;
      store[path] = data;
    },
    spawnIn: (cmd) => {
      commands.push(cmd);
      return exitCode;
    },
    check: () => Promise.reject(new Error("unused")),
  };
  return { deps, out, err, written, commands, store };
}

const planFile = (plan: TransactionPlan) => ({
  [join(CWD, PLAN_DIR, `${plan.plan_id}.json`)]: JSON.stringify(plan),
  [join(CWD, "package.json")]: JSON.stringify({ name: "app", scripts: {} }),
});

test("applying a clean plan installs with scripts suppressed and writes a receipt", async () => {
  const plan = samplePlan();
  const { deps, commands, written } = makeDeps(planFile(plan));
  expect(await runWarden(["apply", plan.plan_id], deps)).toBe(0);
  expect(commands[0]).toEqual(["npm", "install", "esbuild@0.25.8", "--ignore-scripts"]);
  const receiptPath = Object.keys(written).find((path) => path.includes(RECEIPT_DIR)) as string;
  const receipt = JSON.parse(written[receiptPath] as string) as TransactionReceipt;
  expect(receipt.result).toBe("applied");
});

test("the last receipt is written so verify has something to read without an id", async () => {
  const plan = samplePlan();
  const { deps, written } = makeDeps(planFile(plan));
  await runWarden(["apply", plan.plan_id], deps);
  expect(Object.keys(written)).toContain(join(CWD, ".warden", "last-receipt.json"));
});

test("applying without a plan id is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["apply", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPLY_USAGE");
});

test("applying an unknown plan id refuses rather than guessing", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["apply", "wtxn_missing", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPLY_UNKNOWN_PLAN");
});

test("a corrupt plan file is treated as no plan at all", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, PLAN_DIR, "wtxn_bad.json")]: "{not json",
  });
  expect(await runWarden(["apply", "wtxn_bad", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPLY_UNKNOWN_PLAN");
});

test("an unapproved install script refuses with exit 20 and runs nothing", async () => {
  const plan = samplePlan({
    delta: {
      ...samplePlan().delta,
      scriptSurface: [scriptChange],
      newScriptSurface: [scriptChange],
    },
  });
  const { deps, out, commands } = makeDeps(planFile(plan));
  expect(await runWarden(["apply", plan.plan_id, "--json"], deps)).toBe(20);
  expect(JSON.parse(out[0] as string).reason).toContain("unapproved install scripts");
  expect(commands).toEqual([]);
});

test("approving the exact artifact lets the same plan apply", async () => {
  const plan = samplePlan({
    delta: {
      ...samplePlan().delta,
      scriptSurface: [scriptChange],
      newScriptSurface: [scriptChange],
    },
  });
  const files = planFile(plan);
  const { deps, written } = makeDeps(files);
  expect(await runWarden(["approve-script", "esbuild@0.25.8", "--hook", "postinstall"], deps)).toBe(
    0,
  );
  const approvals = JSON.parse(written[join(CWD, ".warden", "approvals.json")] as string);
  expect(approvals.approvals[0]).toMatchObject({
    package: "esbuild",
    version: "0.25.8",
    hook: "postinstall",
    script_hash: hashScript(SCRIPT),
    integrity: "sha512-esbuild",
    scope: "repo",
  });
  expect(await runWarden(["apply", plan.plan_id], deps)).toBe(0);
});

test("an approval is written to the user scope when asked", async () => {
  const { deps, written } = makeDeps();
  await runWarden(
    ["approve-script", "esbuild@0.25.8", "--hook", "postinstall", "--scope", "user"],
    deps,
  );
  expect(Object.keys(written)).toContain(join(HOME, ".warden", "approvals.json"));
});

test("approving records a note when one is given", async () => {
  const { deps, out } = makeDeps();
  await runWarden(
    ["approve-script", "esbuild@0.25.8", "--hook", "postinstall", "--note", "reviewed", "--json"],
    deps,
  );
  expect(JSON.parse(out[0] as string).note).toBe("reviewed");
});

test("an explicit integrity overrides what the registry reports", async () => {
  const { deps, out } = makeDeps();
  await runWarden(
    [
      "approve-script",
      "esbuild@0.25.8",
      "--hook",
      "postinstall",
      "--integrity",
      "sha512-pinned",
      "--json",
    ],
    deps,
  );
  expect(JSON.parse(out[0] as string).integrity).toBe("sha512-pinned");
});

test("approving without a version or a hook is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["approve-script", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPROVE_USAGE");

  const second = makeDeps();
  expect(await runWarden(["approve-script", "esbuild@0.25.8", "--json"], second.deps)).toBe(30);
  expect(JSON.parse(second.out[0] as string).error.code).toBe("WARDEN_APPROVE_USAGE");
});

test("approving a version that does not exist is refused", async () => {
  const { deps, out } = makeDeps();
  expect(
    await runWarden(["approve-script", "esbuild@9.9.9", "--hook", "postinstall", "--json"], deps),
  ).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPROVE_UNKNOWN");
});

test("approving a hook the package does not have is refused rather than recorded", async () => {
  const { deps, out } = makeDeps();
  expect(
    await runWarden(["approve-script", "esbuild@0.25.9", "--hook", "postinstall", "--json"], deps),
  ).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPROVE_NO_SCRIPT");
});

test("an unreachable registry cannot be turned into an approval", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const { deps, out } = makeDeps();
  const code = await runWarden(
    ["approve-script", "esbuild@0.25.8", "--hook", "postinstall", "--json"],
    deps,
  );
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPROVE_ERROR");
});

test("an unwritable approvals file is reported rather than silently lost", async () => {
  const { deps, out } = makeDeps();
  deps.writeFile = () => {
    throw new Error("read-only");
  };
  expect(
    await runWarden(["approve-script", "esbuild@0.25.8", "--hook", "postinstall", "--json"], deps),
  ).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPROVE_WRITE");
});

test("a failed install rolls back and exits 30", async () => {
  const plan = samplePlan();
  const { deps, out } = makeDeps(planFile(plan), 1);
  expect(await runWarden(["apply", plan.plan_id, "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).result).toBe("rolled_back");
});

test("a registry failure while resolving a script body is an error, not an install", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const plan = samplePlan({
    delta: {
      ...samplePlan().delta,
      scriptSurface: [scriptChange],
      newScriptSurface: [scriptChange],
    },
  });
  const { deps, out, commands } = makeDeps(planFile(plan));
  const code = await runWarden(["apply", plan.plan_id, "--json"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_APPLY_ERROR");
  expect(commands).toEqual([]);
});

test("verifying an applied receipt against a matching lockfile passes", async () => {
  const lock = JSON.stringify({
    packages: { "": {}, "node_modules/esbuild": { version: "0.25.8" } },
  });
  const { deps: seed } = makeDeps({ [join(CWD, "package-lock.json")]: lock });
  const receipt = verifyReceipt(
    {
      schema_version: 1,
      transaction_id: "wtxn_t",
      plan_id: "wtxn_plan",
      command: "npm install esbuild",
      manager: { name: "npm" },
      graph_before: "sha256:before",
      graph_after: "sha256:x",
      policy_digest: "sha256:p",
      artifacts: [],
      approvals: [],
      suppressed_scripts: [],
      verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
      result: "applied",
      analyzer_version: "test",
    },
    seed,
  );
  expect(receipt.checks.find((check) => check.name === "graph matches receipt")?.ok).toBe(false);
});

test("a receipt whose graph matches the installed lockfile verifies end to end", async () => {
  const plan = samplePlan();
  const files = planFile(plan);
  const { deps, store } = makeDeps(files);
  await runWarden(["apply", plan.plan_id], deps);
  const receipt = JSON.parse(store[join(CWD, ".warden", "last-receipt.json")] as string);
  store[join(CWD, "package-lock.json")] = JSON.stringify({ packages: {} });
  receipt.graph_after = verifyReceipt(receipt, deps).installed_digest;
  store[join(CWD, ".warden", "last-receipt.json")] = JSON.stringify(receipt);
  expect(await runWarden(["verify"], deps)).toBe(0);
});

test("verifying with no receipt at all is an error, not a pass", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["verify", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_VERIFY_NO_RECEIPT");
});

test("verifying a named receipt that does not exist is an error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["verify", "wtxn_nope", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.reason).toContain("wtxn_nope");
});

test("a corrupt receipt is treated as no receipt", async () => {
  const { deps } = makeDeps({ [join(CWD, ".warden", "last-receipt.json")]: "{not json" });
  expect(await runWarden(["verify"], deps)).toBe(30);
});

test("a graph that no longer matches the receipt fails verification with exit 20", async () => {
  const receipt: TransactionReceipt = {
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:before",
    graph_after: "sha256:not-what-is-installed",
    policy_digest: "sha256:p",
    artifacts: [],
    approvals: [],
    suppressed_scripts: [],
    verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
    result: "applied",
    analyzer_version: "test",
  };
  const { deps, out } = makeDeps({
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(receipt),
  });
  expect(await runWarden(["verify", "--json"], deps)).toBe(20);
  const report = JSON.parse(out[0] as string);
  expect(report.verified).toBe(false);
  expect(report.checks.find((check: { name: string }) => check.name === "result").ok).toBe(true);
});

test("a rolled-back receipt never verifies as a good transaction", async () => {
  const receipt: TransactionReceipt = {
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:before",
    graph_after: "sha256:after",
    policy_digest: "sha256:p",
    artifacts: [
      {
        package: "x",
        version: "1.0.0",
        verdict: "unchecked",
        summary: "beyond budget",
        categories: [],
      },
    ],
    approvals: [],
    suppressed_scripts: [],
    verification: { install: "pass", test: "fail", typecheck: "skipped", build: "skipped" },
    result: "rolled_back",
    analyzer_version: "test",
  };
  const { deps, out } = makeDeps({
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(receipt),
  });
  await runWarden(["verify", "--json"], deps);
  const report = JSON.parse(out[0] as string);
  const failing = report.checks
    .filter((check: { ok: boolean }) => !check.ok)
    .map((check: { name: string }) => check.name);
  expect(failing).toContain("result");
  expect(failing).toContain("project verification");
  expect(failing).toContain("artifact coverage");
});

test("--quiet suppresses both the receipt and the verification report", async () => {
  setVerbosity("quiet");
  const plan = samplePlan();
  const { deps, err } = makeDeps(planFile(plan));
  await runWarden(["apply", plan.plan_id], deps);
  await runWarden(["verify"], deps);
  await runWarden(["approve-script", "esbuild@0.25.8", "--hook", "postinstall"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("the rendered receipt states the outcome, the verification, and where it was written", () => {
  setColor(false);
  const text = renderReceipt({
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:a",
    graph_after: "sha256:b",
    policy_digest: "sha256:p",
    artifacts: [],
    approvals: [],
    suppressed_scripts: [{ package: "esbuild", version: "0.25.8", hooks: ["postinstall"] }],
    verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
    result: "applied",
    analyzer_version: "test",
  });
  expect(text).toContain("APPLIED");
  expect(text).toContain("install    pass");
  expect(text).toContain("1 packages with scripts suppressed");
  expect(text).toContain("receipt written to");
});

test("a refused receipt renders the reason and no receipt path", () => {
  setColor(false);
  const text = renderReceipt({
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:a",
    graph_after: "sha256:b",
    policy_digest: "sha256:p",
    artifacts: [],
    approvals: [],
    suppressed_scripts: [],
    verification: { install: "skipped", test: "skipped", typecheck: "skipped", build: "skipped" },
    result: "refused",
    reason: "unapproved install scripts: esbuild@0.25.8 (postinstall)",
    analyzer_version: "test",
  });
  expect(text).toContain("REFUSED");
  expect(text).toContain("unapproved install scripts");
  expect(text).not.toContain("receipt written to");
});

test("a rolled-back receipt renders as rolled back", () => {
  setColor(false);
  const text = renderReceipt({
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:a",
    graph_after: "sha256:b",
    policy_digest: "sha256:p",
    artifacts: [],
    approvals: [],
    suppressed_scripts: [],
    verification: { install: "fail", test: "skipped", typecheck: "skipped", build: "skipped" },
    result: "rolled_back",
    analyzer_version: "test",
  });
  expect(text).toContain("ROLLED BACK");
});

test("the rendered verification lists each check and the plan it belongs to", () => {
  setColor(false);
  const text = renderVerify({
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_plan",
    installed_digest: "sha256:a",
    receipt_digest: "sha256:b",
    checks: [
      { name: "graph matches receipt", ok: false, detail: "digests differ" },
      { name: "result", ok: true, detail: "the transaction was applied" },
    ],
    verified: false,
  });
  expect(text).toContain("fail");
  expect(text).toContain("graph matches receipt");
  expect(text).toContain("plan wtxn_plan");
});

test("an unwritable receipt directory does not lose the outcome", async () => {
  const plan = samplePlan();
  const { deps, out } = makeDeps(planFile(plan));
  deps.mkdir = () => {
    throw new Error("read-only");
  };
  await runWarden(["apply", plan.plan_id, "--json"], deps);
  expect(JSON.parse(out[0] as string).reason).toContain("receipt could not be written");
});

test("a receipt whose plan is gone cannot confirm the policy it was issued under", async () => {
  const receipt: TransactionReceipt = {
    schema_version: 1,
    transaction_id: "wtxn_t",
    plan_id: "wtxn_vanished",
    command: "npm install esbuild",
    manager: { name: "npm" },
    graph_before: "sha256:before",
    graph_after: "sha256:after",
    policy_digest: "sha256:p",
    artifacts: [],
    approvals: [],
    suppressed_scripts: [],
    verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
    result: "applied",
    analyzer_version: "test",
  };
  const { deps, out } = makeDeps({
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(receipt),
  });
  expect(await runWarden(["verify", "--json"], deps)).toBe(20);
  const report = JSON.parse(out[0] as string);
  const policy = report.checks.find((check: { name: string }) => check.name === "policy digest");
  expect(policy.ok).toBe(false);
  expect(policy.detail).toContain("cannot be confirmed");
});
