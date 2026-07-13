/**
 * Heuristics: rules A–G, each a pure `(AnalysisInput) => Signal[]`. No I/O.
 * The registry/diff layers build the AnalysisInput; the score layer folds the
 * Signals into a verdict.
 */

import type { Signal, Category, Confidence } from "../schema.ts";
import { findNearestPopular, popularityOf } from "../distance/index.ts";
import { scanShell, scanJs, obfuscationScore } from "./scan.ts";

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
    /** Computed by the engine (downloads >= 100k OR on the popular list). When
     * set, it is authoritative over weeklyDownloads (robust to a downloads-API
     * outage — see issue I10). */
    established?: boolean;
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
// Calibrated against the real-package false-positive corpus. Plain network
// access (require http/https/net, fetch) and lone process.env reads are NOT
// signals — they are ubiquitous in legitimate libraries (every HTTP client,
// every server, every native installer reading proxy env). Only a hardcoded
// raw-IP sink, an env-dump-to-raw-IP (exfiltration shape), eval, and base64
// count. child_process is a capability (non-blocking on its own) kept only so
// the obfuscation+exec-sink correlation can see it.
export function ruleScriptContent(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  // Shell bodies of lifecycle scripts: suspicious patterns HERE are strong (a
  // postinstall has no business running curl|bash), so keep them as actions.
  for (const [name, body] of Object.entries({ ...input.addedScripts, ...input.changedScripts })) {
    for (const f of scanShell(body)) {
      const cat: Category = f.kind === "network" || f.kind === "raw_ip" ? "exfiltration" : "install_script";
      out.push(sig(`script-${f.kind}`, cat, 25, "high", `${name} script ${f.detail}`, { action: true }));
    }
  }

  const findings = input.scanFiles.flatMap((file) =>
    file.text ? scanJs(file.text).map((f) => ({ f, file: file.path })) : [],
  );
  const hasSink = findings.some(({ f }) => f.kind === "raw_ip" || f.kind === "metadata_host");
  const hasEnv = findings.some(({ f }) => f.kind === "env_exfil");
  const hasEnvDump = findings.some(({ f }) => f.kind === "env_dump");
  const hasNetworkAny = findings.some(({ f }) => f.kind === "network" || f.kind === "raw_ip" || f.kind === "metadata_host" || f.kind === "dns_egress");

  for (const { f, file } of findings) {
    if (f.kind === "network" || f.kind === "env_exfil" || f.kind === "env_dump") continue; // capability / used only for exfil-shape
    if (f.kind === "reverse_shell") {
      out.push(sig("code-reverse_shell", "exfiltration", 60, "high", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "raw_ip") {
      out.push(sig("code-raw_ip", "exfiltration", 30, "high", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "metadata_host") {
      out.push(sig("code-metadata_host", "exfiltration", 30, "high", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "dns_egress") {
      out.push(sig("code-dns_egress", "exfiltration", 20, "medium", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "fs_sensitive") {
      out.push(sig("code-fs_sensitive", "exfiltration", 20, "medium", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "destructive_fs") {
      out.push(sig("code-destructive_fs", "metadata_anomaly", 25, "high", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "eval") {
      out.push(sig("code-eval", "obfuscation", 20, "medium", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "base64") {
      out.push(sig("code-base64", "obfuscation", 15, "medium", `code ${f.detail}`, { file, action: true }));
    } else if (f.kind === "child_process") {
      // Capability only (native modules use it): non-action, low weight.
      out.push(sig("code-child_process", "install_script", 10, "low", `code ${f.detail}`, { file }));
    }
  }

  // Exfiltration shape, two forms:
  //  - env READ + a hardcoded raw IP / metadata endpoint (destination is a tell), or
  //  - whole-environment DUMP + ANY network egress (the dump itself is the tell,
  //    so this catches hostname/domain exfiltration, not just raw IPs).
  // A single env var read + a request to a hostname is NOT flagged (that is what
  // every legitimate API client does) — the discriminator is the raw IP or the
  // whole-env dump.
  if ((hasSink && hasEnv) || (hasEnvDump && hasNetworkAny)) {
    out.push(sig("exfil-shape", "exfiltration", 35, "high", "sends environment variables to an external destination (exfiltration shape)", { action: true }));
  }
  return out;
}

// --- Rule C: obfuscation -----------------------------------------------------
export function ruleObfuscation(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  for (const file of input.scanFiles) {
    if (!file.text) continue;
    if (!/\.(js|cjs|mjs|ts|cts|mts)$/i.test(file.path)) continue;
    const { score, reason, hard } = obfuscationScore(file.text);
    // Only flag DELIBERATE obfuscation (hard signature). Plain minification is
    // not a signal — that removes the vue/react-dom/typescript false WARNs.
    if (hard) {
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

  // An established package (real, high download count OR on the popular list) is
  // not a typosquat — it IS a real package. Removes false positives on popular
  // short-named / seed-missing packages like `got`, and is robust to a
  // downloads-API outage via the popular-list fallback (see issue I10). This
  // MUST run before scoped-impersonation: legitimate scoped ecosystems
  // (@types/react, @testing-library/react) wrap popular unscoped names too, and
  // their establishment is what distinguishes them from @typo_scope/eslint.
  const established = input.meta.established ?? (input.meta.weeklyDownloads ?? 0) >= 100_000;
  if (established) return out;

  // Scoped impersonation: an unfamiliar scope wrapping a very popular unscoped
  // name (e.g. @typescript_eslinter/eslint). A real popular package would not
  // live under a random OBSCURE scope — established scoped packages already
  // returned above.
  const scoped = input.name.match(/^@[^/]+\/(.+)$/);
  if (scoped) {
    const bareWeekly = popularityOf(scoped[1]!);
    if (bareWeekly !== undefined && bareWeekly >= 10_000_000) {
      out.push(sig("scoped-impersonation", "typosquat", 55, "high", `scoped name wraps popular package "${scoped[1]}" (~${Math.round(bareWeekly / 1e6)}M weekly) under an unfamiliar scope`, { action: true }));
      return out;
    }
  }

  const m = findNearestPopular(input.name);
  if (m) {
    const popularityGap = m.targetWeekly >= 1_000_000;
    if (m.normalizedCollision && m.homoglyph) {
      // Homoglyph collision (l0dash→lodash): strong.
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

// --- Rule: direct-URL / git dependencies (manifest) --------------------------
// A dependency pinned to a raw http(s)/git/tarball URL fetches untrusted,
// unpinned code outside the registry (GuardDog `direct_url_dependency`). Legit
// in some monorepos, so this warns rather than blocks on its own.
const URL_DEP_RE = /^(https?:|git\+|git:|github:|bitbucket:|gitlab:)/i;
export function ruleManifest(input: AnalysisInput): Signal[] {
  const pkg = input.scanFiles.find((f) => f.path === "package.json");
  if (!pkg?.text) return [];
  let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  try {
    parsed = JSON.parse(pkg.text);
  } catch {
    return [];
  }
  const deps = { ...parsed.dependencies, ...parsed.devDependencies, ...parsed.optionalDependencies };
  const urlDeps = Object.entries(deps).filter(([, v]) => typeof v === "string" && URL_DEP_RE.test(v));
  if (!urlDeps.length) return [];
  return [
    sig("direct-url-dependency", "metadata_anomaly", 30, "medium", `depends on a raw URL/git dependency: ${urlDeps.map(([k, v]) => `${k}@${v}`).slice(0, 3).join(", ")}`, { action: true }),
  ];
}

const RULES = [ruleInstallScripts, ruleScriptContent, ruleObfuscation, ruleNameSimilarity, ruleMetadata, ruleManifest];

/** Run all rules and return the flat Signal list. */
export function analyze(input: AnalysisInput): Signal[] {
  return RULES.flatMap((rule) => rule(input));
}

export { scanShell, scanJs, obfuscationScore, entropy } from "./scan.ts";
