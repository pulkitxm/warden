import { expect, test } from "bun:test";
import {
  auditLockEntry,
  auditLockfile,
  entriesFromNpmLock,
  entriesFromPnpmLock,
  entriesFromYarnLock,
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
  expect(auditLockfile("/proj", fsWith({ "bun.lock": "" })).notes[0]).toContain("not parsed yet");
  expect(auditLockfile("/proj", fsWith({ "bun.lockb": "" })).notes[0]).toContain("binary lockfile");
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

const YARN_CLASSIC = `# THIS IS AN AUTOGENERATED FILE.
# yarn lockfile v1


lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c5"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==

evil@^1.0.0:
  version "1.0.0"
  resolved "https://registry.npmjs.help/evil/-/evil-1.0.0.tgz#abc"
  integrity sha512-bbb==

nohash@^1.0.0:
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/nohash/-/nohash-1.0.0.tgz#def"
`;

const YARN_BERRY = `__metadata:
  version: 8

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: 10c0/d8cbea072bb08655bb4c989da418994b073a608dffa608b09ac04b43a791b12aeae7cd7ad919aa4c925f33b48490b5cfe6c1f71d827956071dae2e7bb3a6b74c
  languageName: node
  linkType: hard

"local-pkg@workspace:packages/ui":
  version: 0.0.0-use.local
  resolution: "local-pkg@workspace:packages/ui"
  languageName: unknown
  linkType: soft
`;

const PNPM_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

packages:

  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

  evil@1.0.0:
    resolution: {tarball: https://registry.npmjs.help/evil/-/evil-1.0.0.tgz, integrity: sha512-bbb==}

  nohash@2.0.0:
    resolution: {}

snapshots:

  lodash@4.17.21: {}
`;

test("yarn classic lockfiles are parsed", () => {
  const entries = entriesFromYarnLock(YARN_CLASSIC);
  expect(entries.map((e) => e.name)).toEqual(["lodash", "evil", "nohash"]);
  expect(entries[0]?.version).toBe("4.17.21");
  expect(entries[0]?.resolved).toBe("https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz");
  expect(entries[0]?.integrity?.startsWith("sha512-")).toBe(true);
});

test("yarn berry lockfiles are parsed and workspace links are kept distinguishable", () => {
  const entries = entriesFromYarnLock(YARN_BERRY);
  const lodash = entries.find((e) => e.name === "lodash");
  expect(lodash?.version).toBe("4.17.21");
  expect(lodash?.integrity?.startsWith("sha512-")).toBe(true);
  const local = entries.find((e) => e.name === "local-pkg");
  expect(local?.resolved).toBe("workspace:packages/ui");
});

test("pnpm lockfiles are parsed from the packages block only", () => {
  const entries = entriesFromPnpmLock(PNPM_LOCK);
  expect(entries.map((e) => e.name)).toEqual(["lodash", "evil", "nohash"]);
  expect(entries[0]?.version).toBe("4.17.21");
  expect(entries[0]?.integrity?.startsWith("sha512-")).toBe(true);
  expect(entries[1]?.resolved).toBe("https://registry.npmjs.help/evil/-/evil-1.0.0.tgz");
});

test("a pnpm entry missing its integrity is flagged, which is CVE-2026-50021", () => {
  const report = auditLockfile("/proj", fsWith({ "pnpm-lock.yaml": PNPM_LOCK }));
  expect(report.scanned).toBe(3);
  const rules = report.findings.map((f) => f.rule);
  expect(rules).toContain("lockfile_lookalike_registry");
  expect(report.findings.some((f) => f.file === "pnpm-lock.yaml")).toBe(true);
});

test("a yarn lockfile with a lookalike registry is blocked", () => {
  const report = auditLockfile("/proj", fsWith({ "yarn.lock": YARN_CLASSIC }));
  expect(report.scanned).toBe(3);
  expect(report.findings.map((f) => f.rule)).toContain("lockfile_lookalike_registry");
  expect(report.findings.map((f) => f.rule)).toContain("lockfile_missing_integrity");
});

test("an empty lockfile of a known format is noted rather than reported clean", () => {
  const report = auditLockfile("/proj", fsWith({ "yarn.lock": "# yarn lockfile v1\n" }));
  expect(report.findings).toEqual([]);
  expect(report.notes[0]).toContain("no dependency entries found");
});

test("every supported format is audited when several are present", () => {
  const report = auditLockfile(
    "/proj",
    fsWith({ "pnpm-lock.yaml": PNPM_LOCK, "yarn.lock": YARN_CLASSIC }),
  );
  const files = new Set(report.findings.map((f) => f.file));
  expect(files.has("pnpm-lock.yaml")).toBe(true);
  expect(files.has("yarn.lock")).toBe(true);
});
