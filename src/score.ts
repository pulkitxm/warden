import {
  ANALYZER_VERSION,
  SCHEMA_VERSION,
  type Signal,
  type Verdict,
  type VerdictLevel,
  type VerdictSource,
} from "./schema.ts";

export interface ScoreContext {
  package: string;
  version: string;
  integrity: string;
  source: VerdictSource;
  established?: boolean;
}

const NAME_ATTACK_IDS = new Set([
  "typosquat",
  "homoglyph-typosquat",
  "nonexistent-package",
  "scoped-impersonation",
]);
const HARD_INTENT_IDS = new Set(["provenance-downgrade", "maintainer-changed"]);
const EXEC_SINK_IDS = new Set([
  "code-eval",
  "code-child_process",
  "script-shell_exec",
  "script-eval",
  "script-network",
]);
const LIFECYCLE_IDS = new Set(["install-script-added", "install-script-changed"]);
const LIFECYCLE_SINK_IDS = new Set([
  "code-raw_ip",
  "code-metadata_host",
  "code-fs_sensitive",
  "code-destructive_fs",
  "code-dns_egress",
  "code-eval",
  "code-base64",
  "script-raw_ip",
  "script-network",
  "script-shell_exec",
  "script-eval",
]);

function applicable(signals: Signal[]): Signal[] {
  const hasAction = signals.some((s) => s.action);
  return signals.filter((s) => (s.requiresAction ? hasAction : true));
}

function decide(signals: Signal[], ctx: ScoreContext): { level: VerdictLevel; reason: string } {
  if (ctx.source === "blocklist")
    return { level: "block", reason: "on the known-malware blocklist" };

  const actionSignals = signals.filter((s) => s.action);
  const suppressCapabilityBlock = Boolean(ctx.established);

  if (signals.some((s) => NAME_ATTACK_IDS.has(s.id))) {
    return { level: "block", reason: "high-confidence name attack (typosquat/slopsquat)" };
  }

  if (signals.some((s) => s.id === "code-reverse_shell")) {
    return { level: "block", reason: "reverse shell (socket wired to a spawned shell)" };
  }

  const hard = signals.find((s) => HARD_INTENT_IDS.has(s.id));
  if (hard && actionSignals.some((s) => s.id !== hard.id)) {
    return {
      level: "block",
      reason: `${hard.category.replace(/_/g, " ")} corroborated by a second signal`,
    };
  }

  if (!suppressCapabilityBlock) {
    const hasLifecycle = signals.some((s) => LIFECYCLE_IDS.has(s.id));
    const lifecycleSink = signals.find((s) => LIFECYCLE_SINK_IDS.has(s.id));
    if (hasLifecycle && lifecycleSink) {
      return {
        level: "block",
        reason: `install-time script combined with a ${lifecycleSink.category.replace(/_/g, " ")} sink`,
      };
    }
    if (signals.some((s) => s.id === "exfil-shape")) {
      return {
        level: "block",
        reason: "environment variables sent to a hardcoded IP / metadata endpoint",
      };
    }
    const hasObfuscation = signals.some(
      (s) => s.category === "obfuscation" && s.id === "obfuscated",
    );
    const hasExecSink = signals.some((s) => EXEC_SINK_IDS.has(s.id));
    if (hasObfuscation && hasExecSink) {
      return { level: "block", reason: "obfuscated code combined with an exec sink" };
    }
  }

  if (actionSignals.length > 0) return { level: "warn", reason: "review-worthy signals present" };
  const total = signals.reduce((n, s) => n + s.weight, 0);
  if (total >= 25) return { level: "warn", reason: "elevated risk signals" };
  return { level: "allow", reason: "no risk signals of concern" };
}

export function score(signals: Signal[], ctx: ScoreContext): Verdict {
  const applied = applicable(signals);
  const { level, reason } = decide(applied, ctx);
  const total = Math.min(100, Math.round(applied.reduce((n, s) => n + s.weight, 0)));
  const categories = [...new Set(applied.map((s) => s.category))];

  const summary =
    level === "allow"
      ? `No supply-chain risk signals of concern for ${ctx.package}@${ctx.version}.`
      : `${ctx.package}@${ctx.version} ${level === "block" ? "blocked" : "flagged"}: ${reason}. ${applied
          .slice(0, 3)
          .map((s) => s.evidence.detail)
          .join("; ")}.`;

  return {
    schema_version: SCHEMA_VERSION,
    package: ctx.package,
    version: ctx.version,
    integrity: ctx.integrity,
    verdict: level,
    risk_score: total,
    categories,
    summary,
    evidence: applied.map((s) => s.evidence),
    analyzer_version: ANALYZER_VERSION,
    source: ctx.source,
  };
}
