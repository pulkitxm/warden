/**
 * Heuristics: rules A–G, each a pure `(AnalysisInput) => Signal[]`. No I/O.
 * The registry/diff layers build the AnalysisInput; the score layer folds the
 * Signals into a verdict.
 */

import type { Signal, Category, Confidence } from "@warden/schema";
import { findNearestPopular } from "@warden/distance";
import { scanShell, scanJs, obfuscationScore, type FindingKind } from "./scan.ts";

export interface ScanFile {
  path: string;
  text?: string;
}

export interface AnalysisInput {
  name: string;
  version: string;
  isNewPackage: boolean;
  meta: {
    ageDays?: number;
    weeklyDownloads?: number;
    deprecated?: boolean;
    maintainers: string[];
    previousMaintainers?: string[];
    maintainerEmailChanged?: boolean;
    hasProvenance?: boolean;
    previousHadProvenance?: boolean;
    /** false = name not found on the registry at all (slopsquat). */
    existsOnRegistry?: boolean;
  };
  /** Lifecycle scripts newly added in this version. */
  addedScripts: Record<string, string>;
  /** Lifecycle scripts whose body changed. */
  changedScripts: Record<string, string>;
  /** Files to scan (added+changed, or all files for a brand-new package). */
  scanFiles: ScanFile[];
}

const LIFECYCLE = new Set(["preinstall", "install", "postinstall", "prepare"]);

function sig(
  id: string,
  category: Category,
  weight: number,
  confidence: Confidence,
  detail: string,
  opts: { file?: string; line?: number; action?: boolean; requiresAction?: boolean } = {},
): Signal {
  return {
    id,
    category,
    weight,
    confidence,
    evidence: { file: opts.file ?? "package.json", line: opts.line, detail },
    action: opts.action,
    requiresAction: opts.requiresAction,
  };
}

/** Map a scan finding kind to a category. */
function categoryFor(kind: FindingKind): Category {
  if (kind === "network" || kind === "raw_ip" || kind === "env_exfil") return "exfiltration";
  if (kind === "base64" || kind === "eval") return "obfuscation";
  return "install_script"; // child_process, shell_exec
}

// --- Rule A: install scripts -------------------------------------------------
export function ruleInstallScripts(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  for (const [name] of Object.entries({ ...input.addedScripts, ...input.changedScripts })) {
    if (!LIFECYCLE.has(name)) continue;
    const added = name in input.addedScripts;
    out.push(
      sig(
        added ? "install-script-added" : "install-script-changed",
        "install_script",
        added ? 35 : 25,
        "high",
        added
          ? `${name} lifecycle script ${input.isNewPackage ? "present" : "added (previous version had none)"}`
          : `${name} lifecycle script changed from the previous version`,
        { action: true },
      ),
    );
  }
  return out;
}

// --- Rule B: suspicious script/source content --------------------------------
export function ruleScriptContent(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  // Shell bodies of added/changed lifecycle scripts.
  for (const [name, body] of Object.entries({ ...input.addedScripts, ...input.changedScripts })) {
    for (const f of scanShell(body)) {
      out.push(sig(`script-${f.kind}`, categoryFor(f.kind), 25, "high", `${name} script ${f.detail}`, { action: true }));
    }
  }
  // JS source of changed/added files.
  const findings = input.scanFiles.flatMap((file) =>
    file.text ? scanJs(file.text).map((f) => ({ f, file: file.path })) : [],
  );
  const hasNetwork = findings.some(({ f }) => f.kind === "network" || f.kind === "raw_ip");
  const hasEnv = findings.some(({ f }) => f.kind === "env_exfil");
  for (const { f, file } of findings) {
    if (f.kind === "env_exfil" && !hasNetwork) continue; // env read alone is noise
    const weight = f.kind === "network" || f.kind === "raw_ip" ? 25 : f.kind === "eval" || f.kind === "base64" ? 20 : 15;
    out.push(sig(`code-${f.kind}`, categoryFor(f.kind), weight, "medium", `code ${f.detail}`, { file, action: true }));
  }
  if (hasNetwork && hasEnv) {
    out.push(
      sig("exfil-shape", "exfiltration", 30, "high", "reads environment variables and performs network I/O (exfiltration shape)", {
        action: true,
      }),
    );
  }
  return out;
}

// --- Rule C: obfuscation -----------------------------------------------------
export function ruleObfuscation(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  for (const file of input.scanFiles) {
    if (!file.text) continue;
    if (!/\.(js|cjs|mjs|ts|cts|mts)$/i.test(file.path)) continue;
    const { score, reason } = obfuscationScore(file.text);
    if (score >= 0.5) {
      out.push(sig("obfuscated", "obfuscation", Math.round(20 + score * 15), "medium", `appears obfuscated (${reason})`, { file: file.path, action: true }));
    }
  }
  return out;
}

// --- Rule D: typosquat / slopsquat ------------------------------------------
export function ruleNameSimilarity(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];

  // Slopsquat: name does not exist on the registry at all.
  if (input.meta.existsOnRegistry === false) {
    out.push(sig("nonexistent-package", "slopsquat", 90, "high", `package "${input.name}" does not exist on the registry (likely a hallucinated / slopsquatted name)`, { action: true }));
    return out; // nothing else to say about a package that isn't there
  }

  const m = findNearestPopular(input.name);
  if (m) {
    const popularityGap = m.targetWeekly >= 1_000_000;
    if (m.normalizedCollision && !m.distance) {
      // Homoglyph collision (g00gle→google): strong.
      out.push(sig("homoglyph-typosquat", "typosquat", 60, "high", `name is a homoglyph of popular package "${m.target}" (~${Math.round(m.targetWeekly / 1e6)}M weekly)`, { action: true }));
    } else if (m.normalizedCollision) {
      // Delimiter/plural variant of a real package (class-names vs classnames):
      // legitimate naming is common, so LOW weight — never blocks on its own.
      out.push(sig("delimiter-variant", "typosquat", 30, "medium", `name differs only by delimiter from "${m.target}"`, { action: true }));
    } else if (m.distance <= 2 && popularityGap) {
      // True edit distance to a very popular package: the lodahs case.
      out.push(sig("typosquat", "typosquat", 50, "high", `name is ${m.distance} edit${m.distance > 1 ? "s" : ""} from popular package "${m.target}" (~${Math.round(m.targetWeekly / 1e6)}M weekly downloads)`, { action: true }));
    }
  }
  return out;
}

// --- Rule F: metadata / provenance -------------------------------------------
export function ruleMetadata(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  const { meta } = input;

  // Provenance downgrade (the axios tell): had CI/OIDC provenance, now none.
  if (meta.previousHadProvenance && meta.hasProvenance === false) {
    out.push(sig("provenance-downgrade", "provenance_downgrade", 40, "high", "prior versions had build provenance; this version was published without it", { action: true }));
  }
  // Maintainer turnover.
  if (meta.previousMaintainers?.length && !input.meta.maintainers.some((mn) => meta.previousMaintainers!.includes(mn))) {
    out.push(sig("maintainer-changed", "metadata_anomaly", 30, "high", `all maintainers changed since the previous version (was: ${meta.previousMaintainers.join(", ")})`, { action: true }));
  }
  if (meta.maintainerEmailChanged) {
    out.push(sig("maintainer-email-changed", "metadata_anomaly", 20, "medium", "publisher email changed from the previous version", { action: true }));
  }
  if (meta.deprecated) {
    out.push(sig("deprecated", "metadata_anomaly", 10, "low", "package is marked deprecated"));
  }
  // Newness signals — only count alongside an action signal (handled in scorer).
  if (meta.ageDays !== undefined && meta.ageDays <= 14) {
    out.push(sig("recent-publish", "metadata_anomaly", 15, "low", `published ${meta.ageDays < 1 ? "less than a day" : `${Math.round(meta.ageDays)} day(s)`} ago`, { requiresAction: true }));
  }
  if (meta.weeklyDownloads !== undefined && meta.weeklyDownloads < 1000) {
    out.push(sig("low-install-history", "metadata_anomaly", 10, "low", `low install history (${meta.weeklyDownloads} weekly downloads)`, { requiresAction: true }));
  }
  return out;
}

const RULES = [ruleInstallScripts, ruleScriptContent, ruleObfuscation, ruleNameSimilarity, ruleMetadata];

/** Run all rules and return the flat Signal list. */
export function analyze(input: AnalysisInput): Signal[] {
  return RULES.flatMap((rule) => rule(input));
}

export { scanShell, scanJs, obfuscationScore, entropy } from "./scan.ts";
