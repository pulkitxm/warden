import { expect, test } from "bun:test";
import {
  buildRequest,
  dependencyClassOf,
  replayCommand,
  requestDigest,
  suppressionFor,
  workspaceOf,
} from "../../src/graph/request.ts";

const req = (argv: string[], manager = "npm" as const) =>
  buildRequest({ manager, operation: "add", argv, cwd: "/repo", specs: ["zod"] });

test("the exact argv the user typed is what gets recorded", () => {
  expect(req(["install", "zod", "--save-dev"]).argv).toEqual(["install", "zod", "--save-dev"]);
});

test("a dev dependency stays a dev dependency", () => {
  for (const flag of ["--save-dev", "-D", "--dev"]) {
    expect(dependencyClassOf(["install", "zod", flag])).toBe("dev");
  }
  expect(dependencyClassOf(["install", "zod"])).toBe("prod");
  expect(dependencyClassOf(["install", "zod", "--save-optional"])).toBe("optional");
  expect(dependencyClassOf(["install", "zod", "--save-peer"])).toBe("peer");
});

test("a workspace scope is not lost, in either flag form", () => {
  expect(workspaceOf(["install", "zod", "--workspace", "apps/api"])).toBe("apps/api");
  expect(workspaceOf(["--filter=api", "add", "zod"])).toBe("api");
  expect(workspaceOf(["install", "zod"])).toBeUndefined();
});

test("a flag value is never mistaken for the workspace when it is absent", () => {
  expect(workspaceOf(["install", "--workspace", "--save-dev"])).toBeUndefined();
});

test("exact and global are carried on the request", () => {
  expect(req(["install", "zod", "--save-exact"]).exact).toBe(true);
  expect(req(["install", "-g", "some-cli"]).global).toBe(true);
  expect(req(["install", "zod"]).exact).toBeUndefined();
  expect(req(["install", "zod"]).global).toBeUndefined();
});

test("replay reissues the user's own command rather than a generic install", () => {
  const request = req(["install", "zod", "--save-dev", "--workspace", "apps/api"]);
  expect(replayCommand(request).argv).toEqual([
    "npm",
    "install",
    "zod",
    "--save-dev",
    "--workspace",
    "apps/api",
    "--ignore-scripts",
  ]);
});

test("replay never double-adds suppression the user already passed", () => {
  const request = req(["install", "zod", "--ignore-scripts"]);
  const argv = replayCommand(request).argv;
  expect(argv.filter((arg) => arg === "--ignore-scripts")).toHaveLength(1);
});

test("yarn is suppressed by environment rather than a flag", () => {
  expect(suppressionFor("yarn")).toEqual({ flags: [], env: { YARN_ENABLE_SCRIPTS: "0" } });
  const request = buildRequest({
    manager: "yarn",
    operation: "add",
    argv: ["add", "zod"],
    cwd: "/repo",
    specs: ["zod"],
  });
  const replay = replayCommand(request);
  expect(replay.argv).toEqual(["yarn", "add", "zod"]);
  expect(replay.env.YARN_ENABLE_SCRIPTS).toBe("0");
});

test("every other manager suppresses with the flag, bun included", () => {
  for (const manager of ["npm", "pnpm", "bun"] as const) {
    expect(suppressionFor(manager).flags).toEqual(["--ignore-scripts"]);
  }
});

test("the request digest changes when intent changes", () => {
  const base = requestDigest(req(["install", "zod"]));
  expect(requestDigest(req(["install", "zod"]))).toBe(base);
  expect(requestDigest(req(["install", "zod", "--save-dev"]))).not.toBe(base);
  expect(requestDigest(req(["install", "zod", "--workspace", "apps/api"]))).not.toBe(base);
  expect(requestDigest(req(["install", "zod", "-g"]))).not.toBe(base);
});

test("the digest is stable enough to compare across machines", () => {
  expect(requestDigest(req(["install", "zod"]))).toStartWith("sha256:");
});
