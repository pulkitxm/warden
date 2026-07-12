import type { Flag, PackageMeta, RiskLevel, Signal, TarballDiff } from "../types.js";
import { findTyposquat } from "./nameDistance.js";
import { detectObfuscation } from "./obfuscation.js";
import { scanFiles, scanShellScript } from "./scriptScan.js";

const INSTALL_LIFECYCLE = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "preuninstall",
  "postuninstall",
]);

const AGENT_CONFIG_RE = /(^|\/)(\.claude|\.codex|\.cursor)(\/|$)|(^|\/)AGENTS?\.md$/i;
const LOW_INSTALL_THRESHOLD = 1000;
const RECENT_PUBLISH_DAYS = 14;
const TRUSTED_RELEASE_COUNT = 25;

export interface HeuristicResult {
  signals: Signal[];
  score: number;
  level: RiskLevel;
  flags: Flag[];
  evidence: string[];
}

function isTrustedMaintainer(meta: PackageMeta): boolean {
  const manyReleases = meta.versions.length >= TRUSTED_RELEASE_COUNT;
  const maintainersStable =
    !meta.previousMaintainers ||
    meta.maintainers.some((m) => meta.previousMaintainers?.includes(m));
  return manyReleases && maintainersStable;
}

export function analyze(meta: PackageMeta, diff: TarballDiff): Signal[] {
  const signals: Signal[] = [];

  const squat = findTyposquat(meta.name);
  if (squat) {
    const popularity = squat.targetWeeklyDownloads >= 10_000_000 ? 5 : 4;
    signals.push({
      flag: "typosquat",
      evidence: `name is ${squat.distance} edit${squat.distance > 1 ? "s" : ""} from popular package "${squat.target}" (~${Math.round(squat.targetWeeklyDownloads / 1e6)}M weekly downloads)`,
      weight: popularity,
      isActionSignal: true,
    });
  }

  const changedScriptEntries = [
    ...Object.entries(diff.addedScripts).map(([k, v]) => [k, v, "added"] as const),
    ...Object.entries(diff.changedScripts).map(([k, v]) => [k, v, "changed"] as const),
  ];
  for (const [name, body, kind] of changedScriptEntries) {
    if (INSTALL_LIFECYCLE.has(name)) {
      const flag: Flag = name === "postinstall" ? "new_postinstall" : "new_install_script";
      signals.push({
        flag,
        evidence:
          kind === "added"
            ? `${name} script added${diff.isNewPackage ? "" : " (previous version had none)"}`
            : `${name} script changed from the previous version`,
        weight: 2.5,
        isActionSignal: true,
      });
    }
    for (const finding of scanShellScript(body)) {
      signals.push({
        flag:
          finding.kind === "network" || finding.kind === "raw_ip"
            ? "network_in_script"
            : "suspicious_script_content",
        evidence: `${name} script ${finding.detail}`,
        weight: finding.kind === "network" || finding.kind === "shell_exec" ? 3 : 2,
        isActionSignal: true,
      });
    }
  }

  const scanTargets = diff.isNewPackage
    ? diff.currentFiles
    : [...diff.addedFiles, ...diff.changedFiles];
  const fileFindings = scanFiles(scanTargets);
  const hasNetwork = fileFindings.some((f) => f.kind === "network" || f.kind === "raw_ip");
  const hasEnvRead = fileFindings.some((f) => f.kind === "env_exfil");
  for (const finding of fileFindings) {
    if (finding.kind === "env_exfil" && !hasNetwork) continue;
    const isNet = finding.kind === "network" || finding.kind === "raw_ip";
    signals.push({
      flag: isNet ? "network_in_script" : "suspicious_script_content",
      evidence: `${diff.isNewPackage ? "package" : "newly added/changed code"} ${finding.detail}`,
      weight: finding.kind === "eval" || finding.kind === "child_process" ? 2 : isNet ? 2.5 : 1.5,
      isActionSignal: true,
    });
  }
  if (hasNetwork && hasEnvRead) {
    signals.push({
      flag: "suspicious_script_content",
      evidence: "reads environment variables and performs network I/O (exfiltration shape)",
      weight: 2.5,
      isActionSignal: true,
    });
  }

  const obf = detectObfuscation(scanTargets);
  if (obf.score >= 0.5) {
    signals.push({
      flag: "obfuscated",
      evidence: `${obf.path ?? "code"} appears obfuscated (${obf.reason})`,
      weight: 2 + obf.score,
      isActionSignal: true,
    });
  }

  const touchesAgentConfig =
    scanTargets.some((f) => AGENT_CONFIG_RE.test(f.path)) ||
    changedScriptEntries.some(([, body]) => AGENT_CONFIG_RE.test(body));
  if (touchesAgentConfig) {
    signals.push({
      flag: "writes_agent_config",
      evidence: "package writes to coding-agent config paths (.claude/.codex/AGENTS.md)",
      weight: 4,
      isActionSignal: true,
    });
  }

  if (
    meta.previousMaintainers &&
    meta.previousMaintainers.length > 0 &&
    !meta.maintainers.some((m) => meta.previousMaintainers?.includes(m))
  ) {
    signals.push({
      flag: "maintainer_changed",
      evidence: `all maintainers changed since the previous version (was: ${meta.previousMaintainers.join(", ")})`,
      weight: 2.5,
      isActionSignal: true,
    });
  }

  if (meta.deprecated) {
    signals.push({
      flag: "deprecated",
      evidence: `package is deprecated: ${String(meta.deprecated).slice(0, 120)}`,
      weight: 1,
    });
  }

  if (meta.ageDays !== undefined && meta.ageDays <= RECENT_PUBLISH_DAYS) {
    signals.push({
      flag: "recent_publish",
      evidence: `published ${meta.ageDays < 1 ? "less than a day" : `${Math.round(meta.ageDays)} day(s)`} ago`,
      weight: 1.5,
      requiresActionSignal: true,
    });
  }
  if (meta.weeklyDownloads !== undefined && meta.weeklyDownloads < LOW_INSTALL_THRESHOLD) {
    signals.push({
      flag: "low_install_history",
      evidence: `low install history (${meta.weeklyDownloads} weekly downloads)`,
      weight: 1,
      requiresActionSignal: true,
    });
  }

  return signals;
}

function levelFor(score: number): RiskLevel {
  if (score >= 6.5) return "HIGH";
  if (score >= 3) return "MEDIUM";
  return "LOW";
}

export function score(meta: PackageMeta, signals: Signal[]): HeuristicResult {
  const hasAction = signals.some((s) => s.isActionSignal);
  const trusted = isTrustedMaintainer(meta);

  const applicable = signals.filter((s) => {
    if (s.requiresActionSignal && !hasAction) return false;
    return true;
  });

  let raw = applicable.reduce((sum, s) => sum + s.weight, 0);
  if (trusted && !hasAction) raw *= 0.3;

  const clamped = Math.max(0, Math.min(10, Number(raw.toFixed(1))));
  const level = levelFor(clamped);

  return {
    signals: applicable,
    score: clamped,
    level,
    flags: [...new Set(applicable.map((s) => s.flag))],
    evidence: applicable.map((s) => s.evidence),
  };
}

export function runHeuristics(meta: PackageMeta, diff: TarballDiff): HeuristicResult {
  return score(meta, analyze(meta, diff));
}

export { findTyposquat } from "./nameDistance.js";
