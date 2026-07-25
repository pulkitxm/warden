import { join } from "node:path";
import type { AuditFinding, AuditFs, AuditReport } from "./types.ts";

export const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepublish"];

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
  scripts?: Record<string, string>;
}

export function auditScripts(root: string, fs: AuditFs): AuditReport {
  const notes: string[] = [];
  const findings: AuditFinding[] = [];
  let scanned = 0;

  const manifests = ["package.json", ...fs.glob("node_modules/**/package.json", root)];
  if (manifests.length === 1)
    notes.push("node_modules not installed; only the root manifest was scanned");

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
      if (typeof command === "string" && command.trim())
        findings.push(...auditScript(name, hook, command.trim(), rel));
    }
  }

  return { schema_version: 1, surface: "scripts", root, scanned, findings, notes };
}
