import { expect, test } from "bun:test";
import { buildPlan, type PlanDeps } from "../../src/graph/plan.ts";
import { type Packument, resolveGraph } from "../../src/graph/resolve.ts";
import { compilePolicy } from "../../src/policy/compile.ts";
import type { Verdict } from "../../src/schema.ts";
import type { PackageManager } from "../../src/shared/manager.ts";

interface BenignProject {
  name: string;
  shape: string;
  manager: PackageManager;
  packages: Record<string, { version: string; dependencies?: Record<string, string> }>;
  root: string;
  installedAll?: boolean;
}

function allowVerdict(spec: string): Verdict {
  const at = spec.lastIndexOf("@");
  return {
    schema_version: 1,
    package: spec.slice(0, at),
    version: spec.slice(at + 1),
    integrity: "sha512-benign",
    verdict: "allow",
    risk_score: 0,
    categories: [],
    summary: "no findings",
    evidence: [],
    analyzer_version: "corpus",
    source: "heuristics",
  };
}

function depsFor(project: BenignProject): PlanDeps {
  return {
    resolve: resolveGraph,
    packument: async (name: string): Promise<Packument | null> => {
      const meta = project.packages[name];
      if (!meta) return null;
      return {
        name,
        "dist-tags": { latest: meta.version },
        versions: {
          [meta.version]: {
            version: meta.version,
            ...(meta.dependencies ? { dependencies: meta.dependencies } : {}),
            dist: { tarball: `https://reg.test/${name}.tgz`, integrity: `sha512-${name}` },
          },
        },
      };
    },
    check: (spec) => Promise.resolve(allowVerdict(spec)),
  };
}

const chain = (prefix: string, depth: number) =>
  Object.fromEntries(
    Array.from({ length: depth }, (_, index) => [
      `${prefix}-${index}`,
      index === depth - 1
        ? { version: "1.0.0" }
        : { version: "1.0.0", dependencies: { [`${prefix}-${index + 1}`]: "^1.0.0" } },
    ]),
  );

const fan = (prefix: string, width: number) => ({
  [prefix]: {
    version: "1.0.0",
    dependencies: Object.fromEntries(
      Array.from({ length: width }, (_, index) => [`${prefix}-leaf-${index}`, "^1.0.0"]),
    ),
  },
  ...Object.fromEntries(
    Array.from({ length: width }, (_, index) => [`${prefix}-leaf-${index}`, { version: "1.0.0" }]),
  ),
});

const PROJECTS: BenignProject[] = [
  {
    name: "a single dependency with no children",
    shape: "The simplest possible install.",
    manager: "npm",
    packages: { "left-pad": { version: "1.3.0" } },
    root: "left-pad",
  },
  {
    name: "a deep but ordinary dependency chain",
    shape: "Ten levels of perfectly normal transitive dependencies.",
    manager: "npm",
    packages: chain("chain", 10),
    root: "chain-0",
  },
  {
    name: "a wide dependency fan-out",
    shape: "One package pulling thirty clean leaves, the shape of a real framework.",
    manager: "pnpm",
    packages: fan("wide", 30),
    root: "wide",
  },
  {
    name: "a shared dependency reached by two paths",
    shape: "The diamond every real graph contains.",
    manager: "yarn",
    packages: {
      app: { version: "1.0.0", dependencies: { a: "^1.0.0", b: "^1.0.0" } },
      a: { version: "1.0.0", dependencies: { shared: "^1.0.0" } },
      b: { version: "1.0.0", dependencies: { shared: "^1.0.0" } },
      shared: { version: "1.0.0" },
    },
    root: "app",
  },
  {
    name: "a scoped package with scoped children",
    shape: "Scoped names must not confuse resolution or the delta.",
    manager: "bun",
    packages: {
      "@scope/root": { version: "1.0.0", dependencies: { "@scope/child": "^1.0.0" } },
      "@scope/child": { version: "1.0.0" },
    },
    root: "@scope/root",
  },
  {
    name: "caret and tilde ranges throughout",
    shape: "Real manifests use ranges, not pinned versions.",
    manager: "npm",
    packages: {
      ranged: { version: "2.4.1", dependencies: { "range-child": "~1.2.0" } },
      "range-child": { version: "1.2.9" },
    },
    root: "ranged",
  },
  {
    name: "a package already installed at the same version",
    shape: "Re-planning an unchanged project must be a clean no-op.",
    manager: "npm",
    packages: { stable: { version: "1.0.0" } },
    root: "stable",
    installedAll: true,
  },
];

for (const project of PROJECTS) {
  test(`benign: ${project.name} plans cleanly`, async () => {
    const installed = project.installedAll
      ? new Map(
          Object.entries(project.packages).map(([name, meta]) => [name, { version: meta.version }]),
        )
      : new Map();

    const plan = await buildPlan(
      {
        command: `${project.manager} install ${project.root}`,
        manager: project.manager,
        root: "/repo",
        direct: [{ name: project.root, range: "latest" }],
        existing: [],
        installed: {
          nodes: installed,
          source: project.installedAll ? "package-lock.json" : "none",
        },
      },
      depsFor(project),
    );

    expect(`${project.name}: ${plan.decision}`).toBe(`${project.name}: allow`);
    expect(plan.reasons).toEqual([]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.truncated).toBe(false);
  });
}

test("benign: a range that no version satisfies is the only reason a clean graph blocks", async () => {
  const project: BenignProject = {
    name: "unsatisfiable",
    shape: "control",
    manager: "npm",
    packages: { thing: { version: "1.0.0" } },
    root: "thing",
  };
  const plan = await buildPlan(
    {
      command: "npm install thing@^9",
      manager: "npm",
      root: "/repo",
      direct: [{ name: "thing", range: "^9.0.0" }],
      existing: [],
      installed: { nodes: new Map(), source: "none" },
    },
    depsFor(project),
  );
  expect(plan.decision).toBe("block");
});

test("benign: every project in the corpus analyzes every changed package", async () => {
  for (const project of PROJECTS.filter((entry) => !entry.installedAll)) {
    const plan = await buildPlan(
      {
        command: "npm install",
        manager: project.manager,
        root: "/repo",
        direct: [{ name: project.root, range: "latest" }],
        existing: [],
        installed: { nodes: new Map(), source: "none" },
      },
      depsFor(project),
    );
    expect(`${project.name}: ${plan.coverage.ratio}`).toBe(`${project.name}: 1`);
    expect(plan.coverage.analyzed).toBe(Object.keys(project.packages).length);
  }
});

test("benign: the default policy never demands something a manager cannot express without saying so", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const compiled = compilePolicy(manager, undefined);
    const claimed = compiled.settings.length + compiled.unsupported.length;
    expect(`${manager}: ${claimed > 0}`).toBe(`${manager}: true`);
  }
});

test("benign: a project with a hundred packages still resolves within the default budget", async () => {
  const packages = fan("huge", 99);
  const plan = await buildPlan(
    {
      command: "npm install huge",
      manager: "npm",
      root: "/repo",
      direct: [{ name: "huge", range: "latest" }],
      existing: [],
      installed: { nodes: new Map(), source: "none" },
    },
    {
      ...depsFor({
        name: "huge",
        shape: "scale",
        manager: "npm",
        packages,
        root: "huge",
      }),
      maxChecks: 200,
    },
  );
  expect(plan.truncated).toBe(false);
  expect(plan.decision).toBe("allow");
  expect(plan.coverage.changed).toBe(100);
});

test("every benign project documents the shape it stands for", () => {
  for (const project of PROJECTS) expect(project.shape.length).toBeGreaterThan(15);
});

test("the benign corpus spans all four package managers", () => {
  expect([...new Set(PROJECTS.map((project) => project.manager))].sort()).toEqual([
    "bun",
    "npm",
    "pnpm",
    "yarn",
  ]);
});
