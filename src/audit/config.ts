import { join } from "node:path";
import { damerau } from "../distance/index.ts";
import { hostOf } from "./lockfile.ts";
import type { AuditFinding, AuditFs, AuditReport } from "./types.ts";

const KNOWN_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com", "registry.npmmirror.com"];

export interface NpmrcEntry {
  key: string;
  value: string;
  line: number;
}

export function parseNpmrc(text: string): NpmrcEntry[] {
  const out: NpmrcEntry[] = [];
  text.split("\n").forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return;
    const eq = trimmed.indexOf("=");
    if (eq < 1) return;
    out.push({
      key: trimmed.slice(0, eq).trim(),
      value: trimmed.slice(eq + 1).trim(),
      line: index + 1,
    });
  });
  return out;
}

const REGISTRY_BRANDS = [
  { pattern: /(^|[.-])npm-?js([.-]|$)/i, canonical: "registry.npmjs.org" },
  { pattern: /(^|[.-])yarnpkg([.-]|$)/i, canonical: "registry.yarnpkg.com" },
];

export function lookalikeOf(host: string): string | null {
  if (KNOWN_HOSTS.includes(host)) return null;
  for (const brand of REGISTRY_BRANDS) {
    if (brand.pattern.test(host)) return brand.canonical;
  }
  for (const known of KNOWN_HOSTS) {
    const distance = damerau(host, known);
    if (distance > 0 && distance <= 2) return known;
  }
  return null;
}

export function auditNpmrcEntry(entry: NpmrcEntry, file: string): AuditFinding[] {
  const out: AuditFinding[] = [];
  const key = entry.key.toLowerCase();

  if (key === "registry" || key.endsWith(":registry")) {
    const host = hostOf(entry.value);
    if (entry.value.startsWith("http://")) {
      out.push({
        rule: "config_insecure_registry",
        level: "block",
        target: entry.key,
        file,
        line: entry.line,
        evidence: `registry served over plaintext http (${entry.value})`,
        fix: "use https so package tarballs cannot be replaced in transit",
      });
    }
    if (host) {
      const lookalike = lookalikeOf(host);
      if (lookalike) {
        out.push({
          rule: "config_lookalike_registry",
          level: "block",
          target: entry.key,
          file,
          line: entry.line,
          evidence: `${host} impersonates ${lookalike} without being it`,
          fix: `point this at ${lookalike}; a lookalike registry serves whatever it likes and harvests your token`,
        });
      } else if (!KNOWN_HOSTS.includes(host)) {
        out.push({
          rule: "config_custom_registry",
          level: "warn",
          target: entry.key,
          file,
          line: entry.line,
          evidence: `packages resolve from ${host}`,
          fix: `confirm ${host} is your intended registry and that it is under your control`,
        });
      }
    }
  }

  if (key.includes("_auth") || key.includes("_password")) {
    const literal = !entry.value.startsWith("${");
    if (literal)
      out.push({
        rule: "config_plaintext_credential",
        level: "block",
        target: entry.key,
        file,
        line: entry.line,
        evidence: "credential is written literally into the file",
        fix: `replace the value with \${NPM_TOKEN} and supply it from the environment`,
      });
  }

  if (key === "strict-ssl" && /^false$/i.test(entry.value)) {
    out.push({
      rule: "config_tls_verification_disabled",
      level: "block",
      target: entry.key,
      file,
      line: entry.line,
      evidence: "TLS certificate verification is turned off",
      fix: "remove strict-ssl=false; it makes every install interceptable",
    });
  }

  if (key === "ignore-scripts" && /^false$/i.test(entry.value)) {
    out.push({
      rule: "config_scripts_forced_on",
      level: "warn",
      target: entry.key,
      file,
      line: entry.line,
      evidence: "lifecycle scripts are explicitly re-enabled",
      fix: "drop this line so install hooks stay disabled by default",
    });
  }

  return out;
}

export function auditNpmrcFile(entries: NpmrcEntry[], file: string): AuditFinding[] {
  const alwaysAuth = entries.find(
    (entry) => entry.key.toLowerCase() === "always-auth" && /^true$/i.test(entry.value),
  );
  if (!alwaysAuth) return [];

  const offRegistry = entries.find((entry) => {
    const key = entry.key.toLowerCase();
    if (key !== "registry" && !key.endsWith(":registry")) return false;
    const host = hostOf(entry.value);
    return Boolean(host) && !KNOWN_HOSTS.includes(host as string);
  });
  if (!offRegistry) return [];

  return [
    {
      rule: "config_always_auth_third_party",
      level: "block",
      target: alwaysAuth.key,
      file,
      line: alwaysAuth.line,
      evidence: `always-auth sends your npm credential to ${hostOf(offRegistry.value)}, configured on line ${offRegistry.line}`,
      fix: "set always-auth=false, or scope the credential to the specific registry host instead",
    },
  ];
}

export function auditConfig(root: string, home: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  const candidates: Array<[string, string]> = [
    [".npmrc", join(root, ".npmrc")],
    ["~/.npmrc", join(home, ".npmrc")],
  ];

  for (const [label, path] of candidates) {
    if (!fs.exists(path)) continue;
    let text: string;
    try {
      text = fs.readFile(path);
    } catch (e) {
      notes.push(`${label}: could not be read (${(e as Error).message})`);
      continue;
    }
    const entries = parseNpmrc(text);
    scanned += entries.length;
    for (const entry of entries) findings.push(...auditNpmrcEntry(entry, label));
    findings.push(...auditNpmrcFile(entries, label));
  }

  if (!scanned && !notes.length) notes.push("no .npmrc found in the project or home directory");

  return { schema_version: 1, surface: "config", root, scanned, findings, notes };
}
