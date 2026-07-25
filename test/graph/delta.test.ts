import { expect, test } from "bun:test";
import { digestGraph, graphDelta, type InstalledNode } from "../../src/graph/delta.ts";
import type { GraphNode, GraphResolution } from "../../src/graph/resolve.ts";

function node(name: string, version: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    name,
    version,
    hooks: [],
    depth: 0,
    requiredBy: [],
    optional: false,
    deprecated: false,
    platformSpecific: false,
    ...extra,
  };
}

function resolution(nodes: GraphNode[]): GraphResolution {
  return { nodes, unresolved: [], conflicts: [], truncated: false, complete: true };
}

const installed = (entries: Record<string, string | InstalledNode>) =>
  new Map<string, InstalledNode>(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === "string" ? { version: value } : value,
    ]),
  );

test("a package not currently installed is an addition", () => {
  const delta = graphDelta(resolution([node("new-dep", "1.0.0")]), installed({}));
  expect(delta.added).toHaveLength(1);
  expect(delta.added[0]).toMatchObject({ name: "new-dep", version: "1.0.0", direct: true });
});

test("a version move is a change and carries the semver level", () => {
  const delta = graphDelta(resolution([node("dep", "2.0.0")]), installed({ dep: "1.5.0" }));
  expect(delta.changed[0]).toMatchObject({ from: "1.5.0", version: "2.0.0", level: "major" });
  expect(delta.added).toEqual([]);
});

test("a patch move is reported as patch, not lumped in with a major", () => {
  const delta = graphDelta(resolution([node("dep", "1.5.1")]), installed({ dep: "1.5.0" }));
  expect(delta.changed[0]?.level).toBe("patch");
});

test("an identical version is unchanged and costs no analysis", () => {
  const delta = graphDelta(resolution([node("dep", "1.0.0")]), installed({ dep: "1.0.0" }));
  expect(delta.unchanged).toBe(1);
  expect([...delta.added, ...delta.changed]).toEqual([]);
});

test("a package that leaves the graph is reported as removed", () => {
  const delta = graphDelta(resolution([]), installed({ gone: "1.0.0" }));
  expect(delta.removed).toEqual([{ name: "gone", version: "1.0.0" }]);
});

test("a transitive addition is marked as not direct", () => {
  const delta = graphDelta(resolution([node("deep", "1.0.0", { depth: 3 })]), installed({}));
  expect(delta.added[0]?.direct).toBe(false);
});

test("an install script on a newly added package is new execution surface", () => {
  const delta = graphDelta(
    resolution([node("dep", "1.0.0", { hooks: ["postinstall"] })]),
    installed({}),
  );
  expect(delta.scriptSurface).toHaveLength(1);
  expect(delta.newScriptSurface[0]?.newHooks).toEqual(["postinstall"]);
});

test("a script that already existed at the same hook is not new surface", () => {
  const delta = graphDelta(
    resolution([node("dep", "2.0.0", { hooks: ["postinstall"] })]),
    installed({ dep: { version: "1.0.0", hooks: ["postinstall"] } }),
  );
  expect(delta.scriptSurface).toHaveLength(1);
  expect(delta.newScriptSurface).toEqual([]);
});

test("an upgrade that adds a hook the trusted version did not have is the headline finding", () => {
  const delta = graphDelta(
    resolution([node("dep", "2.0.0", { hooks: ["preinstall", "postinstall"] })]),
    installed({ dep: { version: "1.0.0", hooks: ["preinstall"] } }),
  );
  expect(delta.newScriptSurface[0]?.newHooks).toEqual(["postinstall"]);
});

test("an unchanged package with a script contributes no surface at all", () => {
  const delta = graphDelta(
    resolution([node("dep", "1.0.0", { hooks: ["postinstall"] })]),
    installed({ dep: { version: "1.0.0", hooks: ["postinstall"] } }),
  );
  expect(delta.scriptSurface).toEqual([]);
});

test("platform-specific and deprecated additions are called out separately", () => {
  const delta = graphDelta(
    resolution([
      node("native", "1.0.0", { platformSpecific: true }),
      node("old", "1.0.0", { deprecated: true }),
    ]),
    installed({}),
  );
  expect(delta.platformArtifacts.map((entry) => entry.name)).toEqual(["native"]);
  expect(delta.deprecatedIntroduced.map((entry) => entry.name)).toEqual(["old"]);
});

test("removals are sorted so a diff of two runs is stable", () => {
  const delta = graphDelta(resolution([]), installed({ z: "1.0.0", a: "1.0.0", m: "1.0.0" }));
  expect(delta.removed.map((entry) => entry.name)).toEqual(["a", "m", "z"]);
});

test("a package with no recorded hooks history treats every hook as new", () => {
  const delta = graphDelta(
    resolution([node("dep", "2.0.0", { hooks: ["postinstall"] })]),
    installed({ dep: { version: "1.0.0" } }),
  );
  expect(delta.newScriptSurface[0]?.newHooks).toEqual(["postinstall"]);
});

test("the graph digest is stable regardless of node ordering", () => {
  const first = digestGraph([
    { name: "b", version: "1.0.0" },
    { name: "a", version: "2.0.0" },
  ]);
  const second = digestGraph([
    { name: "a", version: "2.0.0" },
    { name: "b", version: "1.0.0" },
  ]);
  expect(first).toBe(second);
  expect(first).toStartWith("sha256:");
});

test("changing a single version changes the digest", () => {
  const before = digestGraph([{ name: "a", version: "1.0.0" }]);
  const after = digestGraph([{ name: "a", version: "1.0.1" }]);
  expect(before).not.toBe(after);
});

test("an empty graph still digests to something comparable", () => {
  expect(digestGraph([])).toBe(digestGraph([]));
});
