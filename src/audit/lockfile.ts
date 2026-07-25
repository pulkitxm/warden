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

export function entriesFromYarnLock(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  const lines = text.split("\n");
  let current: LockEntry | null = null;

  const push = () => {
    if (current?.name) out.push(current);
    current = null;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indented = /^\s/.test(raw);

    if (!indented) {
      push();
      const header = raw.replace(/:$/, "").split(",")[0]?.trim() ?? "";
      const spec = header.replace(/^"|"$/g, "");
      const at = spec.lastIndexOf("@");
      const name = at > 0 ? spec.slice(0, at) : spec;
      if (name && name !== "__metadata") current = { name };
      continue;
    }
    if (!current) continue;

    const line = raw.trim();
    const version = /^version:?\s+"?([^"\s]+)"?$/.exec(line);
    if (version) current.version = version[1];
    const resolved = /^resolved:?\s+"?([^"\s]+)"?$/.exec(line);
    if (resolved) current.resolved = resolved[1]?.split("#")[0];
    const integrity = /^integrity:?\s+"?([^"\s]+)"?$/.exec(line);
    if (integrity) current.integrity = integrity[1];
    const checksum = /^checksum:?\s+"?([^"\s]+)"?$/.exec(line);
    if (checksum && !current.integrity) current.integrity = `sha512-${checksum[1]}`;
    const resolution = /^resolution:?\s+"(.+)"$/.exec(line);
    if (resolution) {
      const value = resolution[1] ?? "";
      const npm = /^(.+)@npm:(.+)$/.exec(value);
      if (npm) {
        current.name = npm[1] as string;
        current.version = npm[2];
        current.resolved = current.resolved ?? "https://registry.yarnpkg.com/";
      } else {
        const protocol = /^.+@([a-z+]+):(.*)$/.exec(value);
        if (protocol) current.resolved = `${protocol[1]}:${protocol[2]}`;
      }
    }
  }
  push();
  return out.filter((entry) => entry.version || entry.resolved);
}

export function entriesFromPnpmLock(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  const lines = text.split("\n");
  let inPackages = false;
  let current: LockEntry | null = null;

  const push = () => {
    if (current?.name) out.push(current);
    current = null;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;

    if (!/^\s/.test(raw)) {
      push();
      inPackages = raw.startsWith("packages:");
      continue;
    }
    if (!inPackages) continue;

    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (indent === 2 && line.endsWith(":")) {
      push();
      const key = line
        .slice(0, -1)
        .replace(/^["']|["']$/g, "")
        .replace(/^\//, "");
      const at = key.lastIndexOf("@");
      const name = at > 0 ? key.slice(0, at) : key;
      const version = at > 0 ? key.slice(at + 1).split("(")[0] : undefined;
      if (name) current = { name, version };
      continue;
    }
    if (!current) continue;

    const resolution = /^resolution:\s*\{(.+)\}$/.exec(line);
    if (resolution) {
      const body = resolution[1] ?? "";
      const integrity = /integrity:\s*([^,}\s]+)/.exec(body);
      if (integrity) current.integrity = integrity[1];
      const tarball = /tarball:\s*([^,}\s]+)/.exec(body);
      if (tarball) current.resolved = tarball[1];
      const type = /type:\s*([^,}\s]+)/.exec(body);
      if (type?.[1] === "git") current.resolved = current.resolved ?? "git+ssh://unknown";
      const directory = /directory:\s*([^,}\s]+)/.exec(body);
      if (directory) current.resolved = `file:${directory[1]}`;
    }
  }
  push();
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

interface LockFormat {
  file: string;
  parse: (text: string) => LockEntry[];
}

const FORMATS: LockFormat[] = [
  { file: "package-lock.json", parse: entriesFromNpmLock },
  { file: "npm-shrinkwrap.json", parse: entriesFromNpmLock },
  { file: "pnpm-lock.yaml", parse: entriesFromPnpmLock },
  { file: "yarn.lock", parse: entriesFromYarnLock },
];

const UNSUPPORTED: Array<{ file: string; note: string }> = [
  {
    file: "bun.lock",
    note: "bun.lock is not parsed yet; warden reads npm, pnpm, and yarn lockfiles",
  },
  {
    file: "bun.lockb",
    note: "bun.lockb is a binary lockfile; run bun install --save-text-lockfile first",
  },
];

export function auditLockfile(root: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  const present = FORMATS.filter((format) => fs.exists(join(root, format.file)));
  if (!present.length) {
    for (const other of UNSUPPORTED) {
      if (fs.exists(join(root, other.file))) notes.push(other.note);
    }
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
