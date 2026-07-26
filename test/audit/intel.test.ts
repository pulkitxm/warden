import { expect, test } from "bun:test";
import { auditEntryIntel, auditLockEntry, auditLockfile } from "../../src/audit/lockfile.ts";
import type { AuditFs } from "../../src/audit/types.ts";
import { Blocklist, HallucinatedNames } from "../../src/intel/index.ts";
import type { LockEntry } from "../../src/lockfile.ts";

const emptyIntel = {
  blocklist: new Blocklist([]),
  hallucinated: new HallucinatedNames([]),
};

const SHA1 = `sha1-${Buffer.alloc(20).toString("base64")}`;
const SHA512 = `sha512-${Buffer.alloc(64).toString("base64")}`;

const entry = (over: Partial<LockEntry> = {}): LockEntry => ({
  name: "demo",
  version: "1.0.0",
  resolved: "https://registry.npmjs.org/demo/-/demo-1.0.0.tgz",
  integrity: SHA512,
  ...over,
});

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

test("a blocklisted resolved version is blocked and cites its advisory id", () => {
  const intel = {
    blocklist: new Blocklist([{ id: "MAL-CHALK-2025", name: "demo", versions: ["1.0.0"] }]),
    hallucinated: emptyIntel.hallucinated,
  };
  const findings = auditEntryIntel(entry(), "package-lock.json", intel);
  expect(findings[0]?.rule).toBe("lockfile_known_malware");
  expect(findings[0]?.level).toBe("block");
  expect(findings[0]?.evidence).toContain("MAL-CHALK-2025");
  expect(findings[0]?.target).toBe("demo@1.0.0");
});

test("a blocklist entry pinned to other versions leaves this one alone", () => {
  const intel = {
    blocklist: new Blocklist([{ id: "MAL-X", name: "demo", versions: ["9.9.9"] }]),
    hallucinated: emptyIntel.hallucinated,
  };
  expect(auditEntryIntel(entry(), "f", intel)).toEqual([]);
});

test("a blocklist entry with no versions blocks the whole package", () => {
  const intel = {
    blocklist: new Blocklist([{ id: "MAL-ALL", name: "demo" }]),
    hallucinated: emptyIntel.hallucinated,
  };
  expect(auditEntryIntel(entry({ version: "7.7.7" }), "f", intel)[0]?.rule).toBe(
    "lockfile_known_malware",
  );
});

test("a hallucinated package name is blocked as a slopsquat target", () => {
  const intel = {
    blocklist: emptyIntel.blocklist,
    hallucinated: new HallucinatedNames(["demo"]),
  };
  const findings = auditEntryIntel(entry(), "f", intel);
  expect(findings[0]?.rule).toBe("lockfile_hallucinated_name");
  expect(findings[0]?.level).toBe("block");
});

test("malware takes precedence over the slopsquat and typosquat rules", () => {
  const intel = {
    blocklist: new Blocklist([{ id: "MAL-X", name: "demo" }]),
    hallucinated: new HallucinatedNames(["demo"]),
  };
  expect(auditEntryIntel(entry(), "f", intel).map((f) => f.rule)).toEqual([
    "lockfile_known_malware",
  ]);
});

test("a name one edit from a popular package warns without blocking", () => {
  const findings = auditEntryIntel(entry({ name: "expres" }), "f", emptyIntel);
  expect(findings[0]?.rule).toBe("lockfile_typosquat");
  expect(findings[0]?.level).toBe("warn");
  expect(findings[0]?.evidence).toContain("express");
});

test("ordinary dependency names are not treated as typosquats", () => {
  for (const name of ["left-pad", "acorn", "oldhash", "nohash", "demo"]) {
    expect(`${name}:${auditEntryIntel(entry({ name }), "f", emptyIntel).length}`).toBe(`${name}:0`);
  }
});

test("an entry with no version is still identified by name", () => {
  const intel = {
    blocklist: new Blocklist([{ id: "MAL-X", name: "demo" }]),
    hallucinated: emptyIntel.hallucinated,
  };
  expect(auditEntryIntel(entry({ version: undefined }), "f", intel)[0]?.target).toBe("demo");
});

test("a malformed integrity hash is blocked, not silently accepted", () => {
  const findings = auditLockEntry(entry({ integrity: "not-a-hash" }), "package-lock.json");
  const malformed = findings.find((f) => f.rule === "lockfile_malformed_integrity");
  expect(malformed?.level).toBe("block");
  expect(malformed?.evidence).toContain("not-a-hash");
});

test("valid and weak hashes keep their existing treatment", () => {
  expect(auditLockEntry(entry({ integrity: SHA512 }), "f").map((f) => f.rule)).not.toContain(
    "lockfile_malformed_integrity",
  );

  const weak = auditLockEntry(entry({ integrity: SHA1 }), "f").map((f) => f.rule);
  expect(weak).toContain("lockfile_weak_integrity");
  expect(weak).not.toContain("lockfile_malformed_integrity");
});

test("truncated, invalid, and wrongly sized digests are malformed", () => {
  for (const integrity of [
    "sha512-aaa",
    "sha512-%%%",
    `sha256-${Buffer.alloc(64).toString("base64")}`,
  ]) {
    expect(auditLockEntry(entry({ integrity }), "f").map((f) => f.rule)).toContain(
      "lockfile_malformed_integrity",
    );
  }
});

test("multiple integrity entries and metadata options remain valid", () => {
  const integrity = `${SHA1} ${SHA512}?download`;
  const rules = auditLockEntry(entry({ integrity }), "f").map((f) => f.rule);
  expect(rules).not.toContain("lockfile_malformed_integrity");
  expect(rules).not.toContain("lockfile_weak_integrity");
});

test("auditLockfile runs intel over every parsed entry", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "root" },
      "node_modules/demo": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/demo/-/demo-1.0.0.tgz",
        integrity: SHA512,
      },
    },
  });
  const report = auditLockfile("/proj", fsWith({ "package-lock.json": lock }), {
    blocklist: new Blocklist([{ id: "MAL-DEMO", name: "demo", versions: ["1.0.0"] }]),
    hallucinated: emptyIntel.hallucinated,
  });
  expect(report.findings.map((f) => f.rule)).toContain("lockfile_known_malware");
  expect(report.scanned).toBe(1);
});
