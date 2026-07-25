import { expect, test } from "bun:test";
import {
  auditLockEntry,
  auditLockfile,
  entriesFromNpmLock,
  hostOf,
  type LockEntry,
} from "../../src/audit/lockfile.ts";
import type { AuditFs } from "../../src/audit/types.ts";

const clean: LockEntry = {
  name: "good",
  version: "1.0.0",
  resolved: "https://registry.npmjs.org/good/-/good-1.0.0.tgz",
  integrity: "sha512-aaa",
};

function fsWith(files: Record<string, string>): AuditFs {
  return {
    exists: (path) => Object.keys(files).some((name) => path.endsWith(name)),
    readFile: (path) => {
      const hit = Object.entries(files).find(([name]) => path.endsWith(name));
      if (!hit) throw new Error(`ENOENT ${path}`);
      return hit[1];
    },
    glob: () => [],
  };
}

test("a clean registry entry produces no findings", () => {
  expect(auditLockEntry(clean, "package-lock.json")).toEqual([]);
});

const cases: Array<[string, Partial<LockEntry>, string, "warn" | "block"]> = [
  [
    "off-registry host",
    { resolved: "https://packages.internal.example/good/-/good-1.0.0.tgz" },
    "lockfile_off_registry_host",
    "block",
  ],
  [
    "registry impersonation",
    { resolved: "https://registry.npmjs.help/good/-/good-1.0.0.tgz" },
    "lockfile_lookalike_registry",
    "block",
  ],
  [
    "plaintext transport",
    { resolved: "http://registry.npmjs.org/good/-/good-1.0.0.tgz" },
    "lockfile_insecure_transport",
    "block",
  ],
  [
    "missing integrity",
    { resolved: "https://registry.npmjs.org/good/-/good-1.0.0.tgz", integrity: undefined },
    "lockfile_missing_integrity",
    "block",
  ],
  ["weak integrity", { integrity: "sha1-aaa" }, "lockfile_weak_integrity", "warn"],
  [
    "git dependency",
    { resolved: "git+ssh://git@github.com/a/b.git#abc", integrity: undefined },
    "lockfile_git_dependency",
    "warn",
  ],
  [
    "file dependency",
    { resolved: "file:../local", integrity: undefined },
    "lockfile_file_dependency",
    "warn",
  ],
];

for (const [name, over, rule, level] of cases) {
  test(`lockfile audit flags ${name}`, () => {
    const findings = auditLockEntry({ ...clean, ...over }, "package-lock.json");
    const hit = findings.find((f) => f.rule === rule);
    expect(hit).toBeDefined();
    expect(hit?.level).toBe(level);
    expect(hit?.fix.length).toBeGreaterThan(10);
  });
}

test("git and file entries are not also reported as missing integrity", () => {
  for (const resolved of ["git+ssh://git@github.com/a/b.git#abc", "file:../local"]) {
    const findings = auditLockEntry({ ...clean, resolved, integrity: undefined }, "lock");
    expect(findings.map((f) => f.rule)).not.toContain("lockfile_missing_integrity");
  }
});

test("entriesFromNpmLock reads the packages map and skips the root and links", () => {
  const entries = entriesFromNpmLock(
    JSON.stringify({
      packages: {
        "": { version: "1.0.0" },
        "node_modules/a": { version: "1.0.0", resolved: "https://x/a.tgz", integrity: "sha512-a" },
        "packages/ui": { link: true },
        "node_modules/a/node_modules/b": { version: "2.0.0" },
      },
    }),
  );
  expect(entries.map((e) => e.name)).toEqual(["a", "b"]);
});

test("entriesFromNpmLock falls back to the legacy dependencies map", () => {
  const entries = entriesFromNpmLock(
    JSON.stringify({ dependencies: { legacy: { version: "1.0.0" } } }),
  );
  expect(entries).toEqual([
    { name: "legacy", version: "1.0.0", resolved: undefined, integrity: undefined },
  ]);
});

test("hostOf returns null for values that are not URLs", () => {
  expect(hostOf("registry.npmjs.org/x")).toBeNull();
  expect(hostOf("https://registry.npmjs.org/x")).toBe("registry.npmjs.org");
});

test("a project with no lockfile reports a note rather than a finding", () => {
  const report = auditLockfile("/proj", fsWith({}));
  expect(report.findings).toEqual([]);
  expect(report.notes).toEqual(["no lockfile found"]);
});

test("a bun lockfile is reported as unsupported, not silently clean", () => {
  const report = auditLockfile("/proj", fsWith({ "bun.lock": "" }));
  expect(report.notes[0]).toContain("npm-format lockfiles");
});

test("an unparseable lockfile becomes a note instead of a crash", () => {
  const report = auditLockfile("/proj", fsWith({ "package-lock.json": "{not json" }));
  expect(report.findings).toEqual([]);
  expect(report.notes[0]).toContain("could not be parsed");
});

test("auditLockfile counts entries and collects findings", () => {
  const report = auditLockfile(
    "/proj",
    fsWith({
      "package-lock.json": JSON.stringify({
        packages: {
          "": {},
          "node_modules/a": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/a.tgz",
            integrity: "sha512-a",
          },
          "node_modules/b": { version: "1.0.0", resolved: "http://evil.example/b.tgz" },
        },
      }),
    }),
  );
  expect(report.scanned).toBe(2);
  expect(report.surface).toBe("lockfile");
  expect(report.findings.map((f) => f.rule)).toContain("lockfile_insecure_transport");
});
