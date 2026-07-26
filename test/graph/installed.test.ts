import { expect, test } from "bun:test";
import {
  type InstalledFs,
  manifestRequirements,
  readInstalledGraph,
} from "../../src/graph/installed.ts";
import { LOCK_FORMATS } from "../../src/lockfile.ts";

function fsWith(files: Record<string, string>): InstalledFs {
  return {
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
  };
}

const npmLock = JSON.stringify({
  packages: {
    "": { name: "root" },
    "node_modules/left-pad": { version: "1.3.0" },
    "node_modules/chalk": { version: "5.3.0" },
  },
});

test("an npm lockfile becomes the current graph", () => {
  const graph = readInstalledGraph(fsWith({ "/repo/package-lock.json": npmLock }), "/repo");
  expect(graph.source).toBe("package-lock.json");
  expect(graph.nodes.get("left-pad")).toEqual({ version: "1.3.0" });
  expect(graph.nodes.size).toBe(2);
});

test("a shrinkwrap is read the same way as a lockfile", () => {
  const graph = readInstalledGraph(fsWith({ "/repo/npm-shrinkwrap.json": npmLock }), "/repo");
  expect(graph.source).toBe("npm-shrinkwrap.json");
});

test("a pnpm lockfile is understood", () => {
  const lock = [
    "lockfileVersion: '9.0'",
    "packages:",
    "  left-pad@1.3.0:",
    "    resolution: {}",
  ].join("\n");
  const graph = readInstalledGraph(fsWith({ "/repo/pnpm-lock.yaml": lock }), "/repo");
  expect(graph.source).toBe("pnpm-lock.yaml");
  expect(graph.nodes.get("left-pad")?.version).toBe("1.3.0");
});

test("a yarn lockfile is understood", () => {
  const lock = [
    "left-pad@^1.3.0:",
    '  version "1.3.0"',
    '  resolved "https://registry.yarnpkg.com/left-pad"',
  ].join("\n");
  const graph = readInstalledGraph(fsWith({ "/repo/yarn.lock": lock }), "/repo");
  expect(graph.source).toBe("yarn.lock");
  expect(graph.nodes.get("left-pad")?.version).toBe("1.3.0");
});

test("a bun lockfile is understood, so a bun project has a graph at all", () => {
  const lock = JSON.stringify({
    lockfileVersion: 1,
    packages: {
      "left-pad": ["left-pad@1.3.0", "", {}, "sha512-lp"],
      "pkg-a": ["pkg-a@workspace:pkg-a"],
    },
  });
  const graph = readInstalledGraph(fsWith({ "/repo/bun.lock": lock }), "/repo");
  expect(graph.source).toBe("bun.lock");
  expect(graph.nodes.get("left-pad")).toMatchObject({
    version: "1.3.0",
    integrity: "sha512-lp",
  });
  expect(graph.nodes.has("pkg-a")).toBe(false);
});

test("every lockfile the audit surface reads also produces a graph", () => {
  expect(LOCK_FORMATS.map((format) => format.file)).toContain("bun.lock");
});

test("hooks are read from what is actually installed, so the baseline is real", () => {
  const graph = readInstalledGraph(
    fsWith({
      "/repo/package-lock.json": npmLock,
      "/repo/node_modules/left-pad/package.json": JSON.stringify({
        scripts: { postinstall: "node index.js", test: "jest" },
      }),
    }),
    "/repo",
  );
  expect(graph.nodes.get("left-pad")?.hooks).toEqual(["postinstall"]);
  expect(graph.nodes.get("chalk")?.hooks).toBeUndefined();
});

test("a scoped package's manifest is found at its nested path", () => {
  const lock = JSON.stringify({
    packages: { "": {}, "node_modules/@scope/pkg": { version: "1.0.0" } },
  });
  const graph = readInstalledGraph(
    fsWith({
      "/repo/package-lock.json": lock,
      "/repo/node_modules/@scope/pkg/package.json": JSON.stringify({ scripts: { install: "x" } }),
    }),
    "/repo",
  );
  expect(graph.nodes.get("@scope/pkg")?.hooks).toEqual(["install"]);
});

test("an installed package with no scripts records an empty hook list, not unknown", () => {
  const graph = readInstalledGraph(
    fsWith({
      "/repo/package-lock.json": npmLock,
      "/repo/node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad" }),
    }),
    "/repo",
  );
  expect(graph.nodes.get("left-pad")?.hooks).toEqual([]);
});

test("a corrupt installed manifest leaves the hook history unknown rather than empty", () => {
  const graph = readInstalledGraph(
    fsWith({
      "/repo/package-lock.json": npmLock,
      "/repo/node_modules/left-pad/package.json": "{not json",
    }),
    "/repo",
  );
  expect(graph.nodes.get("left-pad")?.hooks).toBeUndefined();
});

test("a corrupt lockfile falls through to the next format rather than throwing", () => {
  const lock = ["left-pad@^1.3.0:", '  version "1.3.0"'].join("\n");
  const graph = readInstalledGraph(
    fsWith({ "/repo/package-lock.json": "{not json", "/repo/yarn.lock": lock }),
    "/repo",
  );
  expect(graph.source).toBe("yarn.lock");
});

test("no lockfile at all is an empty graph, which makes everything an addition", () => {
  const graph = readInstalledGraph(fsWith({}), "/repo");
  expect(graph).toMatchObject({ source: "none" });
  expect(graph.nodes.size).toBe(0);
});

test("the manifest supplies the requirements a graph transaction must preserve", () => {
  const requirements = manifestRequirements(
    fsWith({
      "/repo/package.json": JSON.stringify({
        dependencies: { chalk: "^5.0.0" },
        devDependencies: { vitest: "^1.0.0" },
        optionalDependencies: { fsevents: "^2.0.0" },
      }),
    }),
    "/repo",
  );
  expect(requirements).toEqual([
    { name: "chalk", range: "^5.0.0" },
    { name: "vitest", range: "^1.0.0" },
    { name: "fsevents", range: "^2.0.0", optional: true },
  ]);
});

test("a missing or corrupt manifest yields no requirements instead of throwing", () => {
  expect(manifestRequirements(fsWith({}), "/repo")).toEqual([]);
  expect(manifestRequirements(fsWith({ "/repo/package.json": "{bad" }), "/repo")).toEqual([]);
});

test("a manifest with no dependency sections yields nothing", () => {
  expect(
    manifestRequirements(fsWith({ "/repo/package.json": JSON.stringify({ name: "x" }) }), "/repo"),
  ).toEqual([]);
});
