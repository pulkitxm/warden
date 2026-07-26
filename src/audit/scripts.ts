import { join } from "node:path";
import { parseVersion, satisfies } from "../semver.ts";
import type { AuditFinding, AuditFs, AuditReport } from "./types.ts";

export const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepublish"];
const APPROVAL_SCRIPTS = new Set(["preinstall", "install", "postinstall", "prepare"]);

interface ScriptPattern {
  rule: string;
  level: "warn" | "block";
  test: RegExp;
  evidence: string;
  fix: string;
}

const PATTERNS: ScriptPattern[] = [
  {
    rule: "script_pipes_download_to_shell",
    level: "block",
    test: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/i,
    evidence: "downloads a remote payload and pipes it straight into a shell",
    fix: "remove the pipe-to-shell; fetch to a file, review it, and run it explicitly",
  },
  {
    rule: "script_raw_ip_endpoint",
    level: "block",
    test: /\bhttps?:\/\/\d{1,3}(\.\d{1,3}){3}\b/,
    evidence: "contacts a bare IP address rather than a named host",
    fix: "confirm the endpoint; bare IPs bypass certificate and reputation checks",
  },
  {
    rule: "script_base64_payload",
    level: "block",
    test: /base64\s+(-d|--decode)|Buffer\.from\([^)]*["']base64["']\)|atob\s*\(/,
    evidence: "decodes a base64 blob at install time",
    fix: "inline the real command; base64 in an install hook hides its own behaviour",
  },
  {
    rule: "script_inline_node_eval",
    level: "warn",
    test: /\bnode\s+(-e|--eval)\b/,
    evidence: "evaluates inline JavaScript during install",
    fix: "move the logic into a checked-in script file so it can be reviewed and diffed",
  },
  {
    rule: "script_credential_path_access",
    level: "block",
    test: /(\.ssh\b|\.npmrc\b|\.aws\b|id_rsa|\.git-credentials|\.env\b)/,
    evidence: "references a credential file during install",
    fix: "remove the credential access; install hooks must not read secrets",
  },
  {
    rule: "script_env_exfiltration",
    level: "block",
    test: /process\.env\b[\s\S]{0,120}(fetch|https?\.request|axios|XMLHttpRequest)|(fetch|https?\.request|axios|XMLHttpRequest)[\s\S]{0,120}process\.env\b|\benv\b\s*\|\s*(curl|wget)/,
    evidence: "reads the environment and sends it over the network",
    fix: "remove the network call; this is the shape of a credential stealer",
  },
];

export function auditScript(
  pkg: string,
  hook: string,
  command: string,
  file: string,
): AuditFinding[] {
  const out: AuditFinding[] = PATTERNS.filter((p) => p.test.test(command)).map((p) => ({
    rule: p.rule,
    level: p.level,
    target: `${pkg} (${hook})`,
    file,
    evidence: `${p.evidence}: ${command}`,
    fix: p.fix,
  }));
  if (!out.length) {
    out.push({
      rule: "script_lifecycle_present",
      level: "warn",
      target: `${pkg} (${hook})`,
      file,
      evidence: `runs on install: ${command}`,
      fix: "install with --ignore-scripts, or confirm this hook is expected",
    });
  }
  return out;
}

interface ManifestScripts {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
  trustedDependencies?: string[];
  pnpm?: { onlyBuiltDependencies?: string[] };
  dependenciesMeta?: Record<string, { built?: boolean }>;
}

type AllowlistManager = "npm" | "bun" | "pnpm" | "yarn" | "none";

export interface AllowlistEntry {
  name: string;
  range?: string;
  allowed: boolean;
}

export interface Allowlist {
  manager: AllowlistManager;
  configured: boolean;
  entries: AllowlistEntry[];
}

function splitSelector(selector: string): { name: string; range?: string } | null {
  const value = selector.trim();
  if (!value) return null;
  const separator = value.startsWith("@")
    ? value.indexOf("@", value.indexOf("/") + 1)
    : value.lastIndexOf("@");
  if (separator <= 0) return { name: value };
  const name = value.slice(0, separator);
  const range = value.slice(separator + 1).trim();
  if (!name || !range || /^(file|git|https?):/i.test(range)) return null;
  return { name, range };
}

function entriesFromMap(values: Record<string, boolean> | undefined): AllowlistEntry[] {
  return Object.entries(values ?? {}).flatMap(([selector, allowed]) => {
    if (typeof allowed !== "boolean") return [];
    const parsed = splitSelector(selector);
    return parsed ? [{ ...parsed, allowed }] : [];
  });
}

function entriesFromNames(names: string[] | undefined): AllowlistEntry[] {
  return (names ?? []).flatMap((selector) => {
    const parsed = splitSelector(selector);
    return parsed ? [{ ...parsed, allowed: true }] : [];
  });
}

function inferredManager(manifest: ManifestScripts): AllowlistManager {
  const declared = manifest.packageManager?.split("@")[0];
  if (declared === "npm" || declared === "bun" || declared === "pnpm" || declared === "yarn")
    return declared;
  if (manifest.allowScripts !== undefined) return "npm";
  if (manifest.trustedDependencies !== undefined) return "bun";
  if (manifest.pnpm?.onlyBuiltDependencies !== undefined) return "pnpm";
  if (manifest.dependenciesMeta !== undefined) return "yarn";
  return "none";
}

export function readAllowlist(
  manifest: ManifestScripts,
  manager: AllowlistManager = inferredManager(manifest),
): Allowlist {
  if (manager === "npm") {
    return {
      manager,
      configured: manifest.allowScripts !== undefined,
      entries: entriesFromMap(manifest.allowScripts),
    };
  }

  if (manager === "bun") {
    return {
      manager,
      configured: manifest.trustedDependencies !== undefined,
      entries: entriesFromNames(manifest.trustedDependencies),
    };
  }

  if (manager === "pnpm") {
    return {
      manager,
      configured: manifest.pnpm?.onlyBuiltDependencies !== undefined,
      entries: entriesFromNames(manifest.pnpm?.onlyBuiltDependencies),
    };
  }

  if (manager === "yarn") {
    return {
      manager,
      configured: manifest.dependenciesMeta !== undefined,
      entries: Object.entries(manifest.dependenciesMeta ?? {}).flatMap(([selector, meta]) => {
        if (typeof meta?.built !== "boolean") return [];
        const parsed = splitSelector(selector);
        return parsed ? [{ ...parsed, allowed: meta.built }] : [];
      }),
    };
  }

  return { manager: "none", configured: false, entries: [] };
}

export function readPnpmAllowlist(text: string): Allowlist {
  const parsed = Bun.YAML.parse(text) as { allowBuilds?: Record<string, boolean | null> };
  const values = parsed?.allowBuilds;
  const allowed = Object.fromEntries(
    Object.entries(values ?? {}).filter((entry): entry is [string, boolean] => {
      return typeof entry[1] === "boolean";
    }),
  );
  return {
    manager: "pnpm",
    configured: values !== undefined,
    entries: entriesFromMap(allowed),
  };
}

function matchesVersion(entry: AllowlistEntry, version: string | undefined): boolean {
  if (!entry.range) return true;
  return version !== undefined && satisfies(version, entry.range);
}

function isExactVersions(range: string): boolean {
  return range.split("||").every((version) => parseVersion(version.trim()) !== null);
}

function managerLabel(manager: AllowlistManager): string {
  if (manager === "none") return "install-script";
  return manager === "pnpm" ? "pnpm build" : `${manager} install-script`;
}

function approvalFix(manager: AllowlistManager, pkg: string, hook: string): string {
  if (manager === "npm")
    return `run npm approve-scripts ${pkg}, or confirm the package works with its ${hook} hook skipped`;
  if (manager === "pnpm")
    return `run pnpm approve-builds, or confirm the package works with its ${hook} hook skipped`;
  if (manager === "bun")
    return `run bun pm trust ${pkg}, or confirm the package works with its ${hook} hook skipped`;
  if (manager === "yarn")
    return `approve ${pkg} through dependenciesMeta, or confirm the package works with its ${hook} hook skipped`;
  return `configure an install-script allowlist, or confirm ${pkg} works with its ${hook} hook skipped`;
}

export function auditAllowlistEntry(
  pkg: string,
  version: string | undefined,
  hook: string,
  allowlist: Allowlist,
  file: string,
): AuditFinding[] {
  const target = version ? `${pkg}@${version}` : pkg;
  const entries = allowlist.entries.filter((entry) => entry.name === pkg);
  const denied = entries.some((entry) => !entry.allowed && matchesVersion(entry, version));
  if (denied) return [];

  const approvals = entries.filter((entry) => entry.allowed);
  const label = managerLabel(allowlist.manager);
  const broad = approvals.find((entry) => !entry.range || !isExactVersions(entry.range));

  if (broad) {
    const range = broad.range ?? "all versions";
    return [
      {
        rule: "script_allowlist_overbroad",
        level: "warn",
        target,
        file,
        evidence: `${label} approval covers "${range}", so future releases can run the ${hook} hook without review`,
        fix:
          allowlist.manager === "bun"
            ? `review ${pkg} again after every upgrade because Bun approvals cannot be version-pinned`
            : `replace the ${pkg} approval with the exact versions you reviewed`,
      },
    ];
  }

  const matching = approvals.find((entry) => matchesVersion(entry, version));
  if (!matching) {
    if (approvals.length && version) {
      const ranges = approvals.map((entry) => entry.range ?? "*").join(", ");
      return [
        {
          rule: "script_allowlist_stale",
          level: "warn",
          target,
          file,
          evidence: `${label} approval covers "${ranges}", not the installed version`,
          fix: `review ${pkg}@${version}, then replace the stale approval with an exact version`,
        },
      ];
    }

    return [
      {
        rule: "script_not_allowlisted",
        level: "warn",
        target,
        file,
        evidence: `declares a ${hook} hook but no ${label} approval covers it`,
        fix: approvalFix(allowlist.manager, pkg, hook),
      },
    ];
  }

  return [];
}

function detectedManager(root: string, fs: AuditFs, manifest: ManifestScripts): AllowlistManager {
  const declared = manifest.packageManager?.split("@")[0];
  if (declared === "npm" || declared === "bun" || declared === "pnpm" || declared === "yarn")
    return declared;
  const signals: Array<[string, AllowlistManager]> = [
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ];
  return signals.find(([file]) => fs.exists(join(root, file)))?.[1] ?? inferredManager(manifest);
}

export function auditScripts(root: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  let installed: string[] = [];
  try {
    installed = fs.glob("node_modules/**/package.json", root);
  } catch (e) {
    notes.push(`node_modules could not be listed (${(e as Error).message}); scan is incomplete`);
  }
  const manifests = ["package.json", ...installed];
  if (!installed.length && !notes.length)
    notes.push("node_modules not installed; only the root manifest was scanned");

  let rootManifest: ManifestScripts = {};
  try {
    rootManifest = JSON.parse(fs.readFile(join(root, "package.json"))) as ManifestScripts;
  } catch {
    rootManifest = {};
  }
  const manager = detectedManager(root, fs, rootManifest);
  let allowlist = readAllowlist(rootManifest, manager);
  if (manager === "pnpm" && fs.exists(join(root, "pnpm-workspace.yaml"))) {
    try {
      allowlist = readPnpmAllowlist(fs.readFile(join(root, "pnpm-workspace.yaml")));
    } catch (e) {
      notes.push(`pnpm-workspace.yaml: could not be parsed (${(e as Error).message})`);
    }
  }
  const reviewed = new Set<string>();

  for (const rel of manifests) {
    let manifest: ManifestScripts;
    try {
      manifest = JSON.parse(fs.readFile(join(root, rel))) as ManifestScripts;
    } catch {
      continue;
    }
    scanned++;
    const name = manifest.name ?? rel;
    for (const hook of LIFECYCLE_SCRIPTS) {
      const command = manifest.scripts?.[hook];
      if (typeof command !== "string" || !command.trim()) continue;
      findings.push(...auditScript(name, hook, command.trim(), rel));
      const identity = `${name}@${manifest.version ?? rel}`;
      if (rel !== "package.json" && APPROVAL_SCRIPTS.has(hook) && !reviewed.has(identity)) {
        reviewed.add(identity);
        findings.push(...auditAllowlistEntry(name, manifest.version, hook, allowlist, rel));
      }
    }
  }

  return { schema_version: 1, surface: "scripts", root, scanned, findings, notes };
}
