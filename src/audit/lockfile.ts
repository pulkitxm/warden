import { join } from "node:path";
import type { AuditFinding, AuditFs, AuditReport } from "./types.ts";

const TRUSTED_HOSTS = new Set([
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "registry.npmmirror.com",
]);

const IMPERSONATION = [
  { pattern: /(^|[.-])npm-?js([.-]|$)/i, canonical: "registry.npmjs.org" },
  { pattern: /(^|[.-])yarnpkg([.-]|$)/i, canonical: "registry.yarnpkg.com" },
];

export interface LockEntry {
  name: string;
  version?: string;
  resolved?: string;
  integrity?: string;
}

interface NpmLockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
}

export function entriesFromNpmLock(text: string): LockEntry[] {
  const lock = JSON.parse(text) as {
    packages?: Record<string, NpmLockPackage>;
    dependencies?: Record<string, NpmLockPackage>;
  };
  const out: LockEntry[] = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (path === "" || meta.link) continue;
    const name = path.replace(/^.*node_modules\//, "");
    out.push({ name, version: meta.version, resolved: meta.resolved, integrity: meta.integrity });
  }
  if (!out.length) {
    for (const [name, meta] of Object.entries(lock.dependencies ?? {}))
      out.push({ name, version: meta.version, resolved: meta.resolved, integrity: meta.integrity });
  }
  return out;
}

export function hostOf(resolved: string): string | null {
  try {
    return new URL(resolved).hostname;
  } catch {
    return null;
  }
}

function isRemoteProtocol(resolved: string): string | null {
  const match = /^([a-z+]+):/i.exec(resolved);
  const scheme = match?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme.startsWith("git") || scheme === "ssh") return "git";
  if (scheme === "http") return "http";
  if (scheme === "file") return "file";
  return null;
}

export function auditLockEntry(entry: LockEntry, file: string): AuditFinding[] {
  const out: AuditFinding[] = [];
  const target = entry.version ? `${entry.name}@${entry.version}` : entry.name;
  const resolved = entry.resolved;

  if (resolved) {
    const protocol = isRemoteProtocol(resolved);
    if (protocol === "git") {
      out.push({
        rule: "lockfile_git_dependency",
        level: "warn",
        target,
        file,
        evidence: `resolved from a git remote (${resolved})`,
        fix: "publish the dependency to a registry, or vendor it, so its contents are immutable and auditable",
      });
    } else if (protocol === "http") {
      out.push({
        rule: "lockfile_insecure_transport",
        level: "block",
        target,
        file,
        evidence: `resolved over plaintext http (${resolved})`,
        fix: "replace the http URL with https so the tarball cannot be swapped in transit",
      });
    } else if (protocol === "file") {
      out.push({
        rule: "lockfile_file_dependency",
        level: "warn",
        target,
        file,
        evidence: `resolved from a local path (${resolved})`,
        fix: "confirm this local path is intentional; it is not reproducible on another machine",
      });
    } else {
      const host = hostOf(resolved);
      if (host && !TRUSTED_HOSTS.has(host)) {
        const impersonates = IMPERSONATION.find((brand) => brand.pattern.test(host));
        out.push(
          impersonates
            ? {
                rule: "lockfile_lookalike_registry",
                level: "block",
                target,
                file,
                evidence: `resolved from ${host}, which impersonates ${impersonates.canonical}`,
                fix: `repoint this entry at ${impersonates.canonical} and rotate any token that touched ${host}`,
              }
            : {
                rule: "lockfile_off_registry_host",
                level: "block",
                target,
                file,
                evidence: `resolved from ${host}, which is not a known public registry`,
                fix: `confirm ${host} is your intended registry mirror, then pin it in .npmrc instead of per-entry URLs`,
              },
        );
      }
    }
  }

  if (resolved && !entry.integrity && isRemoteProtocol(resolved) === null) {
    out.push({
      rule: "lockfile_missing_integrity",
      level: "block",
      target,
      file,
      evidence: "registry tarball recorded without an integrity hash",
      fix: "delete the lockfile and reinstall so the integrity hash is recorded",
    });
  }

  if (entry.integrity?.startsWith("sha1-")) {
    out.push({
      rule: "lockfile_weak_integrity",
      level: "warn",
      target,
      file,
      evidence: "integrity uses sha1, which is not collision resistant",
      fix: "reinstall with a current package manager to upgrade the hash to sha512",
    });
  }

  return out;
}

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];

export function auditLockfile(root: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  const present = LOCKFILES.filter((name) => fs.exists(join(root, name)));
  if (!present.length) {
    for (const other of ["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"]) {
      if (fs.exists(join(root, other)))
        notes.push(`${other} found; warden can only read npm-format lockfiles today`);
    }
    if (!notes.length) notes.push("no lockfile found");
    return { schema_version: 1, surface: "lockfile", root, scanned, findings, notes };
  }

  for (const name of present) {
    let entries: LockEntry[];
    try {
      entries = entriesFromNpmLock(fs.readFile(join(root, name)));
    } catch (e) {
      notes.push(`${name}: could not be parsed (${(e as Error).message})`);
      continue;
    }
    scanned += entries.length;
    for (const entry of entries) findings.push(...auditLockEntry(entry, name));
  }

  return { schema_version: 1, surface: "lockfile", root, scanned, findings, notes };
}
