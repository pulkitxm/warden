import { join } from "node:path";
import { type LockEntry, lockfilesIn, unreadableLockfilesIn } from "../lockfile.ts";
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

export function auditLockfile(root: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  const present = lockfilesIn(fs, root);
  if (!present.length) {
    notes.push(...unreadableLockfilesIn(fs, root));
    if (!notes.length) notes.push("no lockfile found");
    return { schema_version: 1, surface: "lockfile", root, scanned, findings, notes };
  }

  for (const format of present) {
    let entries: LockEntry[];
    try {
      entries = format.parse(fs.readFile(join(root, format.file)));
    } catch (e) {
      notes.push(`${format.file}: could not be parsed (${(e as Error).message})`);
      continue;
    }
    if (!entries.length) {
      notes.push(`${format.file}: no dependency entries found`);
      continue;
    }
    scanned += entries.length;
    for (const entry of entries) findings.push(...auditLockEntry(entry, format.file));
  }

  return { schema_version: 1, surface: "lockfile", root, scanned, findings, notes };
}
