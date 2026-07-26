import { expect, test } from "bun:test";
import { join } from "node:path";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { TransactionPlan } from "../../src/graph/plan.ts";
import type { TransactionReceipt } from "../../src/graph/receipt.ts";
import type { CiFinding } from "../../src/schema.ts";

const ROOT = "/repo";
const LOCK = JSON.stringify({
  packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
});

function makeDeps(changed: string[], files: Record<string, string>) {
  const out: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => ROOT,
    check: () => Promise.reject(new Error("no dependency changed")),
    stdout: (s) => out.push(s),
    stderr: () => undefined,
    exists: (path) => path in files,
    mkdir: () => undefined,
    writeFile: () => undefined,
    glob: () => [],
    readFile: (path) => {
      if (path in files) return files[path] as string;
      throw new Error(`ENOENT ${path}`);
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def456\n", stderr: "" };
      if (args[0] === "diff") return { exitCode: 0, stdout: `${changed.join("\n")}\n`, stderr: "" };
      if (args[0] === "show") return { exitCode: 1, stdout: "", stderr: "no such object" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    },
  };
  return { deps, out };
}

const findings = (out: string[]) => JSON.parse(out.join("")) as CiFinding[];

const receipt = (over: Partial<TransactionReceipt> = {}): TransactionReceipt => ({
  schema_version: 1,
  transaction_id: "wtxn_t",
  plan_id: "wtxn_plan",
  command: "npm install left-pad",
  manager: { name: "npm" },
  graph_before: "sha256:before",
  graph_after: "sha256:after",
  policy_digest: "sha256:policy",
  artifacts: [
    {
      package: "left-pad",
      version: "1.3.0",
      verdict: "allow",
      summary: "no findings",
      categories: [],
    },
  ],
  approvals: [],
  suppressed_scripts: [],
  verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
  result: "applied",
  analyzer_version: "test",
  ...over,
});

test("a lockfile change without a receipt fails ci when receipts are required", async () => {
  const { deps, out } = makeDeps(["package-lock.json"], {
    [join(ROOT, "package-lock.json")]: LOCK,
  });
  expect(await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], deps)).toBe(
    20,
  );
  const rules = findings(out).map((finding) => finding.rule);
  expect(rules).toContain("transaction-receipt");
  expect(findings(out)[0]?.evidence).toContain("no warden transaction receipt");
});

test("the same change passes when receipts are not required", async () => {
  const { deps } = makeDeps(["package-lock.json"], { [join(ROOT, "package-lock.json")]: LOCK });
  expect(await runWarden(["ci", "--reporter", "json"], deps)).toBe(0);
});

test("a change that does not touch the graph is not asked for a receipt", async () => {
  const { deps } = makeDeps(["src/index.ts"], {});
  expect(await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], deps)).toBe(
    0,
  );
});

test("a receipt whose graph does not match the lockfile fails with the digest named", async () => {
  const { deps, out } = makeDeps(["package-lock.json"], {
    [join(ROOT, "package-lock.json")]: LOCK,
    [join(ROOT, ".warden", "last-receipt.json")]: JSON.stringify(receipt()),
  });
  expect(await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], deps)).toBe(
    20,
  );
  expect(
    findings(out)
      .map((finding) => finding.evidence)
      .join(" "),
  ).toContain("graph matches receipt");
});

test("a receipt matching the installed graph passes the gate", async () => {
  const { deps: probe } = makeDeps(["package-lock.json"], {
    [join(ROOT, "package-lock.json")]: LOCK,
    [join(ROOT, ".warden", "last-receipt.json")]: JSON.stringify(receipt()),
  });
  await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], probe);

  const { verifyReceipt } = await import("../../src/cli/commands/verify.ts");
  const digest = verifyReceipt(receipt(), probe).installed_digest;

  const matching = receipt({ graph_after: digest });
  const { policyDigest } = await import("../../src/graph/receipt.ts");
  const plan: TransactionPlan = {
    schema_version: 1,
    plan_id: matching.plan_id,
    command: matching.command,
    manager: "npm",
    root: ROOT,
    direct: [],
    graph_before: matching.graph_before,
    graph_after: matching.graph_after,
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
    artifacts: matching.artifacts,
    unresolved: [],
    conflicts: [],
    truncated: false,
    resolver: "metadata",
    coverage: { analyzed: 1, changed: 1, ratio: 1 },
    decision: "allow",
    reasons: [],
    next_actions: [],
  };
  matching.policy_digest = policyDigest(plan);

  const { deps } = makeDeps(["package-lock.json"], {
    [join(ROOT, "package-lock.json")]: LOCK,
    [join(ROOT, ".warden", "plans", `${matching.plan_id}.json`)]: JSON.stringify(plan),
    [join(ROOT, ".warden", "last-receipt.json")]: JSON.stringify(matching),
  });
  expect(await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], deps)).toBe(
    0,
  );
});

test("a package.json change alone also demands a receipt", async () => {
  const { deps, out } = makeDeps(["package.json"], {
    [join(ROOT, "package.json")]: JSON.stringify({ name: "app", dependencies: {} }),
  });
  expect(await runWarden(["ci", "--reporter", "json", "--require-transaction-receipt"], deps)).toBe(
    20,
  );
  expect(findings(out)[0]?.file).toBe("package.json");
  expect(findings(out)[0]?.verify).toBe("warden verify");
});
