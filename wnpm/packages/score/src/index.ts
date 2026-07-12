/**
 * Fold Signals into a Verdict.
 *
 * The whole product lives or dies on false positives, so the block policy is
 * deliberately conservative and built around an intent-vs-capability split:
 *
 *  - INTENT signals are high-precision tells of malice: a true-edit typosquat
 *    (already gated on a popularity gap), a nonexistent/slopsquat name, a
 *    provenance downgrade, a full maintainer turnover, or the env+network
 *    "exfiltration shape". Any one of the name attacks blocks alone; the others
 *    block when corroborated by a second action signal (the axios / Shai-Hulud
 *    shape: provenance-downgrade + install-script, exfil-shape + install-script).
 *
 *  - CAPABILITY signals (install scripts, obfuscation, a lone network call,
 *    base64) have legitimate uses — native modules run install scripts, bundlers
 *    ship minified code. They warn, they do not block on their own.
 *
 * The one capability correlation that blocks is obfuscation + a code-exec/network
 * sink (GuardDog-style capability+threat), and even that is suppressed for
 * ESTABLISHED, non-recent packages (Next.js's minified bundle calls fetch; that
 * is normal). Malware rides in on new or newly-changed versions, which carry a
 * recent-publish signal and defeat the suppression.
 */

import {
  ANALYZER_VERSION,
  SCHEMA_VERSION,
  type Signal,
  type Verdict,
  type VerdictLevel,
  type VerdictSource,
} from "@warden/schema";

export interface ScoreContext {
  package: string;
  version: string;
  integrity: string;
  source: VerdictSource;
  /** weeklyDownloads >= 100k — used to suppress capability-only blocks. */
  established?: boolean;
}

const NAME_ATTACK_IDS = new Set(["typosquat", "homoglyph-typosquat", "nonexistent-package", "scoped-impersonation"]);
// Hard intent tells: account/publisher takeover signals. High precision, so they
// block when corroborated regardless of how established the package is.
const HARD_INTENT_IDS = new Set(["provenance-downgrade", "maintainer-changed"]);
// Exec sinks for the obfuscation-correlation rule.
const EXEC_SINK_IDS = new Set(["code-eval", "code-child_process", "script-shell_exec", "script-eval", "script-network"]);
// Lifecycle (install/preinstall/postinstall) script signals.
const LIFECYCLE_IDS = new Set(["install-script-added", "install-script-changed"]);
// Sinks that make a lifecycle script malicious: a script that both runs at
// install time AND contacts a hardcoded public IP / cloud metadata endpoint,
// pipes curl to a shell, decodes-then-evals, reads credential/source files, or
// deletes recursively. Legit native installers download from HOSTNAMES (no raw
// IP) and don't do any of these, so they stay clear.
const LIFECYCLE_SINK_IDS = new Set([
  "code-raw_ip", "code-metadata_host", "code-fs_sensitive", "code-destructive_fs",
  "code-dns_egress", "code-eval", "code-base64",
  "script-raw_ip", "script-network", "script-shell_exec", "script-eval",
]);

/** Keep only signals that count: newness (requiresAction) needs an action signal. */
function applicable(signals: Signal[]): Signal[] {
  const hasAction = signals.some((s) => s.action);
  return signals.filter((s) => (s.requiresAction ? hasAction : true));
}

function decide(signals: Signal[], ctx: ScoreContext): { level: VerdictLevel; reason: string } {
  if (ctx.source === "blocklist") return { level: "block", reason: "on the known-malware blocklist" };

  const actionSignals = signals.filter((s) => s.action);
  // Established packages never block on capability correlations (obfuscation,
  // exec sinks, exfil shape) — a rebuilt minified bundle in a 40M-downloads/wk
  // package is normal, and high-release-cadence packages like `next` are almost
  // always "recent" so recency can't be the discriminator. Hijacks of
  // established packages are caught by the blocklist and the hard intent tells
  // (provenance downgrade, maintainer change) below, which are NOT suppressed.
  // This is a deliberate low-false-positive tradeoff (see task-tracker/issues.md).
  const suppressCapabilityBlock = Boolean(ctx.established);

  // 1. Name attacks (already gated on popularity/homoglyph/nonexistence): block alone.
  if (signals.some((s) => NAME_ATTACK_IDS.has(s.id))) {
    return { level: "block", reason: "high-confidence name attack (typosquat/slopsquat)" };
  }

  // 1b. Reverse shell — a socket wired to a spawned shell is never legitimate.
  if (signals.some((s) => s.id === "code-reverse_shell")) {
    return { level: "block", reason: "reverse shell (socket wired to a spawned shell)" };
  }

  // 2. Hard intent (account/publisher takeover) corroborated by a second signal:
  //    blocks regardless of establishment — this is the axios shape.
  const hard = signals.find((s) => HARD_INTENT_IDS.has(s.id));
  if (hard && actionSignals.some((s) => s.id !== hard.id)) {
    return { level: "block", reason: `${hard.category.replace(/_/g, " ")} corroborated by a second signal` };
  }

  // 3. Capability correlations — suppressed for established packages (a rebuilt
  //    minified bundle that calls a sink is normal build tooling; hijacks of
  //    established packages are caught by the blocklist + hard tells above).
  if (!suppressCapabilityBlock) {
    // 3a. Lifecycle script + a malicious sink (the dominant real-world class:
    //     postinstall curl|bash, socket to a raw IP, base64->eval, IMDS theft,
    //     source/secret exfil, destructive fs).
    const hasLifecycle = signals.some((s) => LIFECYCLE_IDS.has(s.id));
    const lifecycleSink = signals.find((s) => LIFECYCLE_SINK_IDS.has(s.id));
    if (hasLifecycle && lifecycleSink) {
      return { level: "block", reason: `install-time script combined with a ${lifecycleSink.category.replace(/_/g, " ")} sink` };
    }
    // 3b. Env-dump-to-raw-IP / metadata exfiltration shape.
    if (signals.some((s) => s.id === "exfil-shape")) {
      return { level: "block", reason: "environment variables sent to a hardcoded IP / metadata endpoint" };
    }
    // 3c. Newly obfuscated code combined with an exec sink.
    const hasObfuscation = signals.some((s) => s.category === "obfuscation" && s.id === "obfuscated");
    const hasExecSink = signals.some((s) => EXEC_SINK_IDS.has(s.id));
    if (hasObfuscation && hasExecSink) {
      return { level: "block", reason: "obfuscated code combined with an exec sink" };
    }
  }

  // Otherwise: warn if there is any action signal or meaningful score.
  if (actionSignals.length > 0) return { level: "warn", reason: "review-worthy signals present" };
  const total = signals.reduce((n, s) => n + s.weight, 0);
  if (total >= 25) return { level: "warn", reason: "elevated risk signals" };
  return { level: "allow", reason: "no risk signals of concern" };
}

/** Compute the Verdict for a set of signals. */
export function score(signals: Signal[], ctx: ScoreContext): Verdict {
  const applied = applicable(signals);
  const { level, reason } = decide(applied, ctx);
  const total = Math.min(100, Math.round(applied.reduce((n, s) => n + s.weight, 0)));
  const categories = [...new Set(applied.map((s) => s.category))];

  const summary =
    level === "allow"
      ? `No supply-chain risk signals of concern for ${ctx.package}@${ctx.version}.`
      : `${ctx.package}@${ctx.version} ${level === "block" ? "blocked" : "flagged"}: ${reason}. ${
          applied.slice(0, 3).map((s) => s.evidence.detail).join("; ")
        }.`;

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
