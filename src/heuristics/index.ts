import { findNearestPopular, popularityOf } from "../distance/index.ts";
import type { Category, Confidence, Signal } from "../schema.ts";
import { obfuscationScore, scanJs, scanShell } from "./scan.ts";

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
    existsOnRegistry?: boolean;
    established?: boolean;
  };
  addedScripts: Record<string, string>;
  changedScripts: Record<string, string>;
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

export function ruleScriptContent(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  for (const [name, body] of Object.entries({ ...input.addedScripts, ...input.changedScripts })) {
    for (const f of scanShell(body)) {
      const cat: Category =
        f.kind === "network" || f.kind === "raw_ip" ? "exfiltration" : "install_script";
      out.push(
        sig(`script-${f.kind}`, cat, 25, "high", `${name} script ${f.detail}`, { action: true }),
      );
    }
  }

  const findings = input.scanFiles.flatMap((file) =>
    file.text ? scanJs(file.text).map((f) => ({ f, file: file.path })) : [],
  );
  const hasSink = findings.some(({ f }) => f.kind === "raw_ip" || f.kind === "metadata_host");
  const hasEnv = findings.some(({ f }) => f.kind === "env_exfil");
  const hasEnvDump = findings.some(({ f }) => f.kind === "env_dump");
  const hasNetworkAny = findings.some(
    ({ f }) =>
      f.kind === "network" ||
      f.kind === "raw_ip" ||
      f.kind === "metadata_host" ||
      f.kind === "dns_egress",
  );

  for (const { f, file } of findings) {
    if (f.kind === "network" || f.kind === "env_exfil" || f.kind === "env_dump") continue;
    if (f.kind === "reverse_shell") {
      out.push(
        sig("code-reverse_shell", "exfiltration", 60, "high", `code ${f.detail}`, {
          file,
          action: true,
        }),
      );
    } else if (f.kind === "raw_ip") {
      out.push(
        sig("code-raw_ip", "exfiltration", 30, "high", `code ${f.detail}`, { file, action: true }),
      );
    } else if (f.kind === "metadata_host") {
      out.push(
        sig("code-metadata_host", "exfiltration", 30, "high", `code ${f.detail}`, {
          file,
          action: true,
        }),
      );
    } else if (f.kind === "dns_egress") {
      out.push(
        sig("code-dns_egress", "exfiltration", 20, "medium", `code ${f.detail}`, {
          file,
          action: true,
        }),
      );
    } else if (f.kind === "fs_sensitive") {
      out.push(
        sig("code-fs_sensitive", "exfiltration", 20, "medium", `code ${f.detail}`, {
          file,
          action: true,
        }),
      );
    } else if (f.kind === "destructive_fs") {
      out.push(
        sig("code-destructive_fs", "metadata_anomaly", 25, "high", `code ${f.detail}`, {
          file,
          action: true,
        }),
      );
    } else if (f.kind === "eval") {
      out.push(
        sig("code-eval", "obfuscation", 20, "medium", `code ${f.detail}`, { file, action: true }),
      );
    } else if (f.kind === "base64") {
      out.push(
        sig("code-base64", "obfuscation", 15, "medium", `code ${f.detail}`, { file, action: true }),
      );
    } else if (f.kind === "child_process") {
      out.push(
        sig("code-child_process", "install_script", 10, "low", `code ${f.detail}`, { file }),
      );
    }
  }

  if ((hasSink && hasEnv) || (hasEnvDump && hasNetworkAny)) {
    out.push(
      sig(
        "exfil-shape",
        "exfiltration",
        35,
        "high",
        "sends environment variables to an external destination (exfiltration shape)",
        { action: true },
      ),
    );
  }
  return out;
}

export function ruleObfuscation(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  for (const file of input.scanFiles) {
    if (!file.text) continue;
    if (!/\.(js|cjs|mjs|ts|cts|mts)$/i.test(file.path)) continue;
    const { score, reason, hard } = obfuscationScore(file.text);
    if (hard) {
      out.push(
        sig(
          "obfuscated",
          "obfuscation",
          Math.round(20 + score * 15),
          "medium",
          `appears obfuscated (${reason})`,
          { file: file.path, action: true },
        ),
      );
    }
  }
  return out;
}

export function ruleNameSimilarity(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];

  if (input.meta.existsOnRegistry === false) {
    out.push(
      sig(
        "nonexistent-package",
        "slopsquat",
        90,
        "high",
        `package "${input.name}" does not exist on the registry (likely a hallucinated / slopsquatted name)`,
        { action: true },
      ),
    );
    return out;
  }

  const established = input.meta.established ?? (input.meta.weeklyDownloads ?? 0) >= 100_000;
  if (established) return out;

  const scoped = input.name.match(/^@[^/]+\/(.+)$/);
  if (scoped) {
    const bareWeekly = popularityOf(scoped[1]!);
    if (bareWeekly !== undefined && bareWeekly >= 10_000_000) {
      out.push(
        sig(
          "scoped-impersonation",
          "typosquat",
          55,
          "high",
          `scoped name wraps popular package "${scoped[1]}" (~${Math.round(bareWeekly / 1e6)}M weekly) under an unfamiliar scope`,
          { action: true },
        ),
      );
      return out;
    }
  }

  const m = findNearestPopular(input.name);
  if (m) {
    const popularityGap = m.targetWeekly >= 1_000_000;
    if (m.normalizedCollision && m.homoglyph) {
      out.push(
        sig(
          "homoglyph-typosquat",
          "typosquat",
          60,
          "high",
          `name is a homoglyph of popular package "${m.target}" (~${Math.round(m.targetWeekly / 1e6)}M weekly)`,
          { action: true },
        ),
      );
    } else if (m.normalizedCollision) {
      out.push(
        sig(
          "delimiter-variant",
          "typosquat",
          30,
          "medium",
          `name differs only by delimiter from "${m.target}"`,
          { action: true },
        ),
      );
    } else if (m.distance <= 2 && popularityGap) {
      out.push(
        sig(
          "typosquat",
          "typosquat",
          50,
          "high",
          `name is ${m.distance} edit${m.distance > 1 ? "s" : ""} from popular package "${m.target}" (~${Math.round(m.targetWeekly / 1e6)}M weekly downloads)`,
          { action: true },
        ),
      );
    }
  }
  return out;
}

export function ruleMetadata(input: AnalysisInput): Signal[] {
  const out: Signal[] = [];
  const { meta } = input;

  if (meta.previousHadProvenance && meta.hasProvenance === false) {
    out.push(
      sig(
        "provenance-downgrade",
        "provenance_downgrade",
        40,
        "high",
        "prior versions had build provenance; this version was published without it",
        { action: true },
      ),
    );
  }
  if (
    meta.previousMaintainers?.length &&
    !input.meta.maintainers.some((mn) => meta.previousMaintainers!.includes(mn))
  ) {
    out.push(
      sig(
        "maintainer-changed",
        "metadata_anomaly",
        30,
        "high",
        `all maintainers changed since the previous version (was: ${meta.previousMaintainers.join(", ")})`,
        { action: true },
      ),
    );
  }
  if (meta.maintainerEmailChanged) {
    out.push(
      sig(
        "maintainer-email-changed",
        "metadata_anomaly",
        20,
        "medium",
        "publisher email changed from the previous version",
        { action: true },
      ),
    );
  }
  if (meta.deprecated) {
    out.push(sig("deprecated", "metadata_anomaly", 10, "low", "package is marked deprecated"));
  }
  if (meta.ageDays !== undefined && meta.ageDays <= 14) {
    out.push(
      sig(
        "recent-publish",
        "metadata_anomaly",
        15,
        "low",
        `published ${meta.ageDays < 1 ? "less than a day" : `${Math.round(meta.ageDays)} day(s)`} ago`,
        { requiresAction: true },
      ),
    );
  }
  if (meta.weeklyDownloads !== undefined && meta.weeklyDownloads < 1000) {
    out.push(
      sig(
        "low-install-history",
        "metadata_anomaly",
        10,
        "low",
        `low install history (${meta.weeklyDownloads} weekly downloads)`,
        { requiresAction: true },
      ),
    );
  }
  return out;
}

const URL_DEP_RE = /^(https?:|git\+|git:|github:|bitbucket:|gitlab:)/i;
export function ruleManifest(input: AnalysisInput): Signal[] {
  const pkg = input.scanFiles.find((f) => f.path === "package.json");
  if (!pkg?.text) return [];
  let parsed: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(pkg.text);
  } catch {
    return [];
  }
  const deps = {
    ...parsed.dependencies,
    ...parsed.devDependencies,
    ...parsed.optionalDependencies,
  };
  const urlDeps = Object.entries(deps).filter(
    ([, v]) => typeof v === "string" && URL_DEP_RE.test(v),
  );
  if (!urlDeps.length) return [];
  return [
    sig(
      "direct-url-dependency",
      "metadata_anomaly",
      30,
      "medium",
      `depends on a raw URL/git dependency: ${urlDeps
        .map(([k, v]) => `${k}@${v}`)
        .slice(0, 3)
        .join(", ")}`,
      { action: true },
    ),
  ];
}

const RULES = [
  ruleInstallScripts,
  ruleScriptContent,
  ruleObfuscation,
  ruleNameSimilarity,
  ruleMetadata,
  ruleManifest,
];

export function analyze(input: AnalysisInput): Signal[] {
  return RULES.flatMap((rule) => rule(input));
}

export { entropy, obfuscationScore, scanJs, scanShell } from "./scan.ts";
