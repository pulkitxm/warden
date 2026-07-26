import { expect, test } from "bun:test";
import { buildPlan, type PlanDeps, type PlanInput } from "../../src/graph/plan.ts";
import { type Packument, resolveGraph } from "../../src/graph/resolve.ts";
import type { Verdict, VerdictLevel } from "../../src/schema.ts";

function verdict(spec: string, level: VerdictLevel, summary = "clean"): Verdict {
  const [name, version] = spec.split("@").filter(Boolean);
  return {
    schema_version: 1,
    package: name as string,
    version: version as string,
    integrity: `sha512-${name}`,
    verdict: level,
    risk_score: level === "block" ? 90 : level === "warn" ? 40 : 5,
    categories: level === "block" ? ["known_malware"] : [],
    summary,
    evidence: [],
    analyzer_version: "test",
    source: "heuristics",
  };
}

interface Fixture {
  packages: Record<
    string,
    {
      deps?: Record<string, string>;
      hooks?: string[];
      deprecated?: boolean;
      os?: string[];
    }
  >;
  verdicts?: Record<string, VerdictLevel>;
  failing?: string[];
}

function makeDeps(fixture: Fixture, overrides: Partial<PlanDeps> = {}) {
  const checked: string[] = [];
  const packument = async (name: string): Promise<Packument | null> => {
    const entry = Object.entries(fixture.packages).find(([spec]) => spec.split("@")[0] === name);
    if (!entry) return null;
    const [spec, meta] = entry;
    const version = spec.split("@")[1] as string;
    return {
      name,
      "dist-tags": { latest: version },
      versions: {
        [version]: {
          version,
          ...(meta.deps ? { dependencies: meta.deps } : {}),
          ...(meta.hooks
            ? { scripts: Object.fromEntries(meta.hooks.map((hook) => [hook, "node x.js"])) }
            : {}),
          ...(meta.deprecated ? { deprecated: "no longer maintained" } : {}),
          ...(meta.os ? { os: meta.os } : {}),
          dist: { tarball: `https://reg.test/${name}.tgz`, integrity: `sha512-${name}` },
        },
      },
    };
  };
  const deps: PlanDeps = {
    resolve: resolveGraph,
    packument,
    check: (spec) => {
      checked.push(spec);
      const name = spec.split("@")[0] as string;
      if (fixture.failing?.includes(name)) return Promise.reject(new Error("registry unreachable"));
      return Promise.resolve(verdict(spec, fixture.verdicts?.[name] ?? "allow"));
    },
    ...overrides,
  };
  return { deps, checked };
}

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  command: "npm install app",
  manager: "npm",
  root: "/repo",
  direct: [{ name: "app", range: "latest" }],
  existing: [],
  installed: { nodes: new Map(), source: "none" },
  ...over,
});

test("a clean direct install with no scripts is allowed", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("allow");
  expect(plan.reasons).toEqual([]);
  expect(plan.next_actions[0]).toBe(`warden apply ${plan.plan_id}`);
});

test("every transitive addition is vetted, not only what the user typed", async () => {
  const { deps, checked } = makeDeps({
    packages: {
      "app@1.0.0": { deps: { mid: "1.0.0" } },
      "mid@1.0.0": { deps: { leaf: "1.0.0" } },
      "leaf@1.0.0": {},
    },
  });
  const plan = await buildPlan(input(), deps);
  expect(checked.sort()).toEqual(["app@1.0.0", "leaf@1.0.0", "mid@1.0.0"]);
  expect(plan.coverage).toMatchObject({ analyzed: 3, changed: 3, ratio: 1 });
});

test("a malicious transitive package blocks the whole transaction", async () => {
  const { deps } = makeDeps({
    packages: { "app@1.0.0": { deps: { evil: "1.0.0" } }, "evil@1.0.0": {} },
    verdicts: { evil: "block" },
  });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("block");
  expect(plan.reasons.join(" ")).toContain("evil");
});

test("a new install script anywhere in the graph needs approval rather than a silent allow", async () => {
  const { deps } = makeDeps({
    packages: {
      "app@1.0.0": { deps: { builder: "1.0.0" } },
      "builder@1.0.0": { hooks: ["postinstall"] },
    },
  });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("needs_approval");
  expect(plan.next_actions[0]).toContain("warden approve-script builder@1.0.0 --hook postinstall");
});

test("a warn verdict warns without demanding approval", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} }, verdicts: { app: "warn" } });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("warn");
});

test("a block outranks a script approval, because the package should not install at all", async () => {
  const { deps } = makeDeps({
    packages: { "app@1.0.0": { hooks: ["postinstall"] } },
    verdicts: { app: "block" },
  });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("block");
  expect(plan.next_actions[0]).toContain("warden explain");
});

test("a package that cannot be analyzed blocks instead of passing", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} }, failing: ["app"] });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("block");
  expect(plan.reasons.join(" ")).toContain("could not be analyzed");
});

test("an unresolvable required dependency blocks the transaction", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": { deps: { ghost: "1.0.0" } } } });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("block");
  expect(plan.reasons.join(" ")).toContain("not found on the registry");
});

test("packages beyond the analysis budget are named rather than counted as clean", async () => {
  const { deps } = makeDeps(
    {
      packages: {
        "app@1.0.0": { deps: { a: "1.0.0", b: "1.0.0" } },
        "a@1.0.0": {},
        "b@1.0.0": {},
      },
    },
    { maxChecks: 1 },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("needs_approval");
  expect(plan.coverage).toMatchObject({ analyzed: 1, changed: 3 });
  expect(plan.artifacts.filter((entry) => entry.verdict === "unchecked")).toHaveLength(2);
});

test("a truncated graph never reports a confident allow", async () => {
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": { deps: { a: "1.0.0" } }, "a@1.0.0": {} } },
    { maxNodes: 1 },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.truncated).toBe(true);
  expect(plan.decision).toBe("needs_approval");
});

test("already-installed packages are not re-vetted, which is what keeps a plan fast", async () => {
  const { deps, checked } = makeDeps({
    packages: { "app@1.0.0": { deps: { stable: "1.0.0" } }, "stable@1.0.0": {} },
  });
  const plan = await buildPlan(
    input({
      installed: {
        nodes: new Map([["stable", { version: "1.0.0" }]]),
        source: "package-lock.json",
      },
    }),
    deps,
  );
  expect(checked).toEqual(["app@1.0.0"]);
  expect(plan.delta.unchanged).toBe(1);
});

test("the plan id is deterministic for the same command and resulting graph", async () => {
  const first = await buildPlan(input(), makeDeps({ packages: { "app@1.0.0": {} } }).deps);
  const second = await buildPlan(input(), makeDeps({ packages: { "app@1.0.0": {} } }).deps);
  expect(first.plan_id).toBe(second.plan_id);
  expect(first.plan_id).toStartWith("wtxn_");
});

test("a different resulting graph produces a different plan id", async () => {
  const first = await buildPlan(input(), makeDeps({ packages: { "app@1.0.0": {} } }).deps);
  const second = await buildPlan(input(), makeDeps({ packages: { "app@2.0.0": {} } }).deps);
  expect(first.plan_id).not.toBe(second.plan_id);
});

test("the plan records both graph digests so CI can verify what was applied", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } });
  const plan = await buildPlan(
    input({
      installed: { nodes: new Map([["old", { version: "1.0.0" }]]), source: "package-lock.json" },
    }),
    deps,
  );
  expect(plan.graph_before).toStartWith("sha256:");
  expect(plan.graph_after).toStartWith("sha256:");
  expect(plan.graph_before).not.toBe(plan.graph_after);
});

test("existing manifest requirements are resolved alongside the new package", async () => {
  const { deps, checked } = makeDeps({
    packages: { "app@1.0.0": {}, "already@1.0.0": {} },
  });
  const plan = await buildPlan(input({ existing: [{ name: "already", range: "1.0.0" }] }), deps);
  expect(checked.sort()).toEqual(["already@1.0.0", "app@1.0.0"]);
  expect(plan.delta.added).toHaveLength(2);
});

test("a package named directly is treated as direct even when something else also needs it", async () => {
  const { deps } = makeDeps({
    packages: { "app@1.0.0": { deps: { shared: "1.0.0" } }, "shared@1.0.0": {} },
  });
  const plan = await buildPlan(
    input({
      direct: [{ name: "shared", range: "1.0.0" }],
      existing: [{ name: "app", range: "1.0.0" }],
    }),
    deps,
  );
  expect(plan.delta.added.find((entry) => entry.name === "shared")?.direct).toBe(true);
});

test("a deprecated addition warns rather than blocking", async () => {
  const packument = async (name: string): Promise<Packument> => ({
    name,
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { version: "1.0.0", deprecated: "no longer maintained" } },
  });
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } }, { packument });
  const plan = await buildPlan(input(), deps);
  expect(plan.decision).toBe("warn");
  expect(plan.reasons.join(" ")).toContain("deprecated");
});

test("a graph transaction with no direct packages still plans the whole manifest", async () => {
  const { deps } = makeDeps({ packages: { "already@1.0.0": {} } });
  const plan = await buildPlan(
    input({ direct: [], existing: [{ name: "already", range: "1.0.0" }], command: "npm install" }),
    deps,
  );
  expect(plan.direct).toEqual([]);
  expect(plan.delta.added).toHaveLength(1);
});

test("coverage is 100 percent when there is nothing to change", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } });
  const plan = await buildPlan(
    input({
      installed: { nodes: new Map([["app", { version: "1.0.0" }]]), source: "package-lock.json" },
    }),
    deps,
  );
  expect(plan.coverage).toMatchObject({ analyzed: 0, changed: 0, ratio: 1 });
  expect(plan.decision).toBe("allow");
});

test("artifacts carry the integrity the verdict was reached against", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } });
  const plan = await buildPlan(input(), deps);
  expect(plan.artifacts[0]).toMatchObject({
    package: "app",
    version: "1.0.0",
    integrity: "sha512-app",
  });
});

test("a conflicting range is surfaced on the plan rather than resolved silently", async () => {
  const packument = async (name: string): Promise<Packument | null> => {
    const table: Record<string, Packument> = {
      a: {
        name: "a",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { version: "1.0.0", dependencies: { shared: "^2.0.0" } } },
      },
      shared: {
        name: "shared",
        "dist-tags": { latest: "2.0.0" },
        versions: { "1.0.0": { version: "1.0.0" }, "2.0.0": { version: "2.0.0" } },
      },
    };
    return table[name] ?? null;
  };
  const { deps } = makeDeps({ packages: {} }, { packument });
  const plan = await buildPlan(
    input({
      direct: [{ name: "shared", range: "1.0.0" }],
      existing: [{ name: "a", range: "1.0.0" }],
    }),
    deps,
  );
  expect(plan.conflicts).toHaveLength(1);
});

test("when the manager itself resolves the graph, its answer is what gets vetted", async () => {
  const { deps, checked } = makeDeps(
    { packages: { "app@1.0.0": { deps: { mid: "1.0.0" } }, "mid@1.0.0": {} } },
    {
      resolveWithManager: () => ({
        nodes: new Map([
          [
            "app",
            {
              version: "2.0.0",
              integrity: "sha512-app",
              resolved: "https://reg.test/app-2.0.0.tgz",
              hooks: ["postinstall"],
            },
          ],
          ["pinned", { version: "9.9.9", integrity: "sha512-pinned" }],
        ]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.resolver).toBe("manager");
  expect(checked.sort()).toEqual(["app@2.0.0", "pinned@9.9.9"]);
  expect(plan.decision).toBe("needs_approval");
  expect(plan.reasons.join(" ")).toContain("app@2.0.0 has a postinstall script");
  expect(plan.unresolved).toEqual([]);
  expect(plan.truncated).toBe(false);
});

test("a manager resolution that names a direct package marks it as direct, not transitive", async () => {
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": {} } },
    {
      resolveWithManager: () => ({
        nodes: new Map([
          ["app", { version: "1.0.0" }],
          ["dep", { version: "1.0.0" }],
        ]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.delta.added.filter((entry) => entry.direct).map((entry) => entry.name)).toEqual([
    "app",
  ]);
});

test("a manager that cannot resolve the graph falls back to registry metadata", async () => {
  const { deps } = makeDeps({ packages: { "app@1.0.0": {} } }, { resolveWithManager: () => null });
  const plan = await buildPlan(input(), deps);
  expect(plan.resolver).toBe("metadata");
  expect(plan.decision).toBe("allow");
});

test("a manager-resolved graph still shows the install scripts it is about to run", async () => {
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": {}, "builder@2.0.0": { hooks: ["postinstall"] } } },
    {
      resolveWithManager: () => ({
        nodes: new Map([
          ["app", { version: "1.0.0" }],
          ["builder", { version: "2.0.0" }],
        ]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.resolver).toBe("manager");
  expect(plan.delta.newScriptSurface.map((change) => `${change.name}@${change.version}`)).toEqual([
    "builder@2.0.0",
  ]);
  expect(plan.decision).toBe("needs_approval");
  expect(plan.next_actions[0]).toContain("approve-script builder@2.0.0 --hook postinstall");
});

test("a manager-resolved graph reports deprecation and platform artifacts too", async () => {
  const { deps } = makeDeps(
    {
      packages: {
        "app@1.0.0": {},
        "old@1.0.0": { deprecated: true },
        "native@1.0.0": { os: ["darwin"] },
      },
    },
    {
      resolveWithManager: () => ({
        nodes: new Map([
          ["app", { version: "1.0.0" }],
          ["old", { version: "1.0.0" }],
          ["native", { version: "1.0.0" }],
        ]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.delta.deprecatedIntroduced.map((change) => change.name)).toEqual(["old"]);
  expect(plan.delta.platformArtifacts.map((change) => change.name)).toEqual(["native"]);
});

test("packages already installed at the same version are not re-read from the registry", async () => {
  const asked: string[] = [];
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": {}, "kept@1.0.0": {} } },
    {
      resolveWithManager: () => ({
        nodes: new Map([
          ["app", { version: "1.0.0" }],
          ["kept", { version: "1.0.0" }],
        ]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const spy: PlanDeps = {
    ...deps,
    packument: (name: string) => {
      asked.push(name);
      return deps.packument(name);
    },
  };
  await buildPlan(
    input({ installed: { nodes: new Map([["kept", { version: "1.0.0" }]]), source: "x" } }),
    spy,
  );
  expect(asked).toEqual(["app"]);
});

test("a registry that cannot describe a manager-resolved package does not sink the plan", async () => {
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": {} }, failing: [] },
    {
      resolveWithManager: () => ({
        nodes: new Map([["app", { version: "1.0.0" }]]),
        lockfile: "package-lock.json",
      }),
      packument: () => Promise.reject(new Error("registry unreachable")),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.resolver).toBe("manager");
  expect(plan.decision).toBe("allow");
});

test("a manager-resolved package missing from the registry keeps what the lockfile said", async () => {
  const { deps } = makeDeps(
    { packages: { "app@1.0.0": {} } },
    {
      resolveWithManager: () => ({
        nodes: new Map([["app", { version: "9.9.9", hooks: ["postinstall"] }]]),
        lockfile: "package-lock.json",
      }),
    },
  );
  const plan = await buildPlan(input(), deps);
  expect(plan.delta.newScriptSurface.map((change) => change.name)).toEqual(["app"]);
});
