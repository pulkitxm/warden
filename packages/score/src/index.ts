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
  type Category,
} from "@warden/schema";

export interface ScoreContext {
  package: string;
  version: string;
  integrity: string;
  source: VerdictSource;
  /** weeklyDownloads >= 100k — used to suppress capability-only blocks. */
  established?: boolean;
}

const INTENT_CATEGORIES = new Set<Category>([
  "known_malware",
  "slopsquat",
  "typosquat",
  "provenance_downgrade",
]);

const NAME_ATTACK_IDS = new Set(["typosquat", "homoglyph-typosquat", "nonexistent-package"]);
const CORROBORATED_INTENT_IDS = new Set(["provenance-downgrade", "exfil-shape", "maintainer-changed"]);
const EXEC_SINK_IDS = new Set(["code-network", "code-eval", "code-child_process", "script-network", "script-shell_exec", "script-eval"]);

/** Keep only signals that count: newness (requiresAction) needs an action signal. */
function applicable(signals: Signal[]): Signal[] {
  const hasAction = signals.some((s) => s.action);
  return signals.filter((s) => (s.requiresAction ? hasAction : true));
}

function decide(signals: Signal[], ctx: ScoreContext): { level: VerdictLevel; reason: string } {
  if (ctx.source === "blocklist") return { level: "block", reason: "on the known-malware blocklist" };

  const actionSignals = signals.filter((s) => s.action);
  const recentPublish = signals.some((s) => s.id === "recent-publish");
  const suppressCapabilityBlock = Boolean(ctx.established) && !recentPublish;

  // 1. Name attacks (already gated on popularity/homoglyph/nonexistence): block alone.
  if (signals.some((s) => NAME_ATTACK_IDS.has(s.id))) {
    return { level: "block", reason: "high-confidence name attack (typosquat/slopsquat)" };
  }

  // 2. Corroborated intent: an intent tell plus any other action signal.
  const intentTell = signals.find((s) => CORROBORATED_INTENT_IDS.has(s.id));
  if (intentTell && actionSignals.some((s) => s.id !== intentTell.id)) {
    return { level: "block", reason: `${intentTell.category.replace(/_/g, " ")} corroborated by a second signal` };
  }

  // 3. Capability correlation: obfuscation + an exec/network sink (not for
  //    established, non-recent packages, where this is normal build tooling).
  const hasObfuscation = signals.some((s) => s.category === "obfuscation" && s.id === "obfuscated");
  const hasExecSink = signals.some((s) => EXEC_SINK_IDS.has(s.id));
  if (hasObfuscation && hasExecSink && !suppressCapabilityBlock) {
    return { level: "block", reason: "obfuscated code combined with a network/exec sink" };
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
