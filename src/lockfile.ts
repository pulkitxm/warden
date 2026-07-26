import { join } from "node:path";

export interface LockfileFs {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
}

export interface LockEntry {
  name: string;
  version?: string;
  resolved?: string;
  integrity?: string;
}

export function splitDescriptor(descriptor: string): { name: string; spec: string } | null {
  const from = descriptor.startsWith("@") ? descriptor.indexOf("/") + 1 : 1;
  if (from <= 0) return null;
  const at = descriptor.indexOf("@", from);
  if (at <= 0) return null;
  return { name: descriptor.slice(0, at), spec: descriptor.slice(at + 1) };
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
      const descriptor = header.replace(/^"|"$/g, "");
      const name = splitDescriptor(descriptor)?.name ?? descriptor;
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
      const split = splitDescriptor(key);
      const name = split?.name ?? key;
      const version = split?.spec.split("(")[0];
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

export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let ahead = index + 1;
      while (ahead < text.length && /\s/.test(text[ahead] as string)) ahead += 1;
      const next = text[ahead];
      if (next === "}" || next === "]") continue;
    }
    out += char;
  }
  return JSON.parse(out);
}

const LOCAL_SPECS = ["workspace:", "link:", "root:"];
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export function entriesFromBunLock(text: string): LockEntry[] {
  const lock = parseJsonc(text) as { packages?: Record<string, unknown> };
  const out: LockEntry[] = [];
  for (const value of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(value)) continue;
    const split = splitDescriptor(typeof value[0] === "string" ? value[0] : "");
    if (!split) continue;
    const { name, spec } = split;
    if (LOCAL_SPECS.some((prefix) => spec.startsWith(prefix))) continue;
    const integrity = value.find(
      (item): item is string => typeof item === "string" && /^sha\d+-/.test(item),
    );
    const entry: LockEntry = { name, ...(integrity ? { integrity } : {}) };
    if (/^[a-z+]+:/i.test(spec)) {
      entry.resolved = spec;
    } else {
      entry.version = spec;
      entry.resolved = typeof value[1] === "string" && value[1] ? value[1] : DEFAULT_REGISTRY;
    }
    out.push(entry);
  }
  return out;
}

export interface LockFormat {
  file: string;
  parse: (text: string) => LockEntry[];
}

export const LOCK_FORMATS: LockFormat[] = [
  { file: "package-lock.json", parse: entriesFromNpmLock },
  { file: "npm-shrinkwrap.json", parse: entriesFromNpmLock },
  { file: "pnpm-lock.yaml", parse: entriesFromPnpmLock },
  { file: "yarn.lock", parse: entriesFromYarnLock },
  { file: "bun.lock", parse: entriesFromBunLock },
];

export const UNREADABLE_LOCKFILES: Array<{ file: string; note: string }> = [
  {
    file: "bun.lockb",
    note: "bun.lockb is bun's binary lockfile; convert it with bun install --save-text-lockfile --frozen-lockfile --lockfile-only and delete bun.lockb",
  },
];

export function lockfilesIn(fs: LockfileFs, root: string): LockFormat[] {
  return LOCK_FORMATS.filter((format) => fs.exists(join(root, format.file)));
}

export function unreadableLockfilesIn(fs: LockfileFs, root: string): string[] {
  return UNREADABLE_LOCKFILES.filter((entry) => fs.exists(join(root, entry.file))).map(
    (entry) => entry.note,
  );
}
