import { expect, test } from "bun:test";
import { requiresRepoScopedApprovals } from "../../src/cli/commands/apply.ts";
import {
  type ApprovalFs,
  collectApprovals,
  hashScript,
  matchesApproval,
  type ScriptApproval,
} from "../../src/graph/approvals.ts";
import { analysisRequirements, scriptRequirements } from "../../src/graph/requirements.ts";

const SCRIPT = "node install.js";

const approval = (over: Partial<ScriptApproval> = {}): ScriptApproval => ({
  schema_version: 1,
  package: "esbuild",
  version: "0.28.1",
  integrity: "sha512-esbuild",
  hook: "postinstall",
  script_hash: hashScript(SCRIPT),
  scope: "repo",
  approved_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const request = () => ({
  package: "esbuild",
  version: "0.28.1",
  integrity: "sha512-esbuild",
  hook: "postinstall",
  script: SCRIPT,
});

function fsWith(files: Record<string, string>): ApprovalFs {
  return {
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    writeFile: () => undefined,
    mkdir: () => undefined,
  };
}

test("changing the version invalidates the approval", () => {
  expect(matchesApproval(approval({ version: "0.28.2" }), request())).toBe(false);
});

test("changing the integrity invalidates the approval", () => {
  expect(matchesApproval(approval({ integrity: "sha512-swapped" }), request())).toBe(false);
});

test("changing the script body invalidates the approval", () => {
  expect(matchesApproval(approval({ script_hash: hashScript("node evil.js") }), request())).toBe(
    false,
  );
});

test("changing the hook invalidates the approval", () => {
  expect(matchesApproval(approval({ hook: "preinstall" }), request())).toBe(false);
});

test("an approval that matches every bound field is the only one that applies", () => {
  expect(matchesApproval(approval(), request())).toBe(true);
});

test("a user approval cannot satisfy a repository that requires repo scope", () => {
  const files = {
    "/repo/.warden/approvals.json": JSON.stringify({
      schema_version: 1,
      approvals: [approval({ package: "repo-scoped" })],
    }),
    "/home/.warden/approvals.json": JSON.stringify({
      schema_version: 1,
      approvals: [approval({ package: "user-scoped", scope: "user" })],
    }),
  };
  const both = collectApprovals(fsWith(files), "/repo", "/home");
  expect(both.map((entry) => entry.package).sort()).toEqual(["repo-scoped", "user-scoped"]);

  const repoOnly = collectApprovals(fsWith(files), "/repo", "/home", true);
  expect(repoOnly.map((entry) => entry.package)).toEqual(["repo-scoped"]);
});

test("a script approval is not the same kind of authority as an analysis exception", () => {
  const requirements = [
    {
      kind: "script" as const,
      artifact: { name: "esbuild", version: "0.28.1" },
      hook: "postinstall",
    },
    { kind: "coverage-budget" as const, unchecked: [{ name: "mystery", version: "1.0.0" }] },
    { kind: "graph-truncation" as const, analyzed: 400, changed: 900 },
  ];
  expect(scriptRequirements(requirements)).toHaveLength(1);
  expect(analysisRequirements(requirements)).toHaveLength(2);
  expect(scriptRequirements(requirements).some((entry) => entry.kind !== "script")).toBe(false);
});

test("a repository opts into repo-scoped approvals through its config, and a broken config does not", () => {
  const at = (files: Record<string, string>) =>
    requiresRepoScopedApprovals(
      {
        exists: (path: string) => path in files,
        readFile: (path: string) => files[path] as string,
      } as never,
      "/repo",
    );

  expect(at({})).toBe(false);
  expect(at({ "/repo/warden.config.json": "{}" })).toBe(false);
  expect(at({ "/repo/warden.config.json": JSON.stringify({ approvals: {} }) })).toBe(false);
  expect(
    at({
      "/repo/warden.config.json": JSON.stringify({ approvals: { requireRepoScope: false } }),
    }),
  ).toBe(false);
  expect(
    at({ "/repo/warden.config.json": JSON.stringify({ approvals: { requireRepoScope: true } }) }),
  ).toBe(true);
  expect(at({ "/repo/warden.config.json": "{ not json" })).toBe(false);
});
