import { join } from "node:path";
import { compareVersions } from "../semver.ts";

export type BaselineSource = "recorded" | "receipt" | "lockfile" | "previous-release" | "none";

export interface TrustedBaseline {
  package: string;
  version: string;
  source: BaselineSource;
  evidence: string;
  recordedAt?: string;
}

export interface BaselineStore {
  schema_version: 1;
  baselines: Array<{
    package: string;
    version: string;
    recordedAt: string;
    note?: string;
  }>;
}

export interface BaselineFs {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => unknown;
  mkdir: (path: string) => unknown;
}

export const BASELINE_FILE = join(".warden", "baselines.json");

export function baselinePath(root: string): string {
  return join(root, BASELINE_FILE);
}

export function readBaselines(fs: BaselineFs, root: string): BaselineStore["baselines"] {
  const path = baselinePath(root);
  if (!fs.exists(path)) return [];
  try {
    const store = JSON.parse(fs.readFile(path)) as BaselineStore;
    return Array.isArray(store.baselines) ? store.baselines : [];
  } catch {
    return [];
  }
}

export function writeBaselines(
  fs: BaselineFs,
  root: string,
  baselines: BaselineStore["baselines"],
): void {
  const sorted = [...baselines].sort((a, b) => a.package.localeCompare(b.package));
  fs.mkdir(join(root, ".warden"));
  fs.writeFile(
    baselinePath(root),
    `${JSON.stringify({ schema_version: 1, baselines: sorted }, null, 2)}\n`,
  );
}

export function recordBaseline(
  fs: BaselineFs,
  root: string,
  entry: { package: string; version: string; recordedAt: string; note?: string },
): BaselineStore["baselines"] {
  const existing = readBaselines(fs, root).filter((row) => row.package !== entry.package);
  const baselines = [...existing, entry];
  writeBaselines(fs, root, baselines);
  return baselines.sort((a, b) => a.package.localeCompare(b.package));
}

export interface BaselineInputs {
  recorded: BaselineStore["baselines"];
  installed: Map<string, { version: string }>;
  receipts: Map<string, string>;
  previousRelease?: string;
}

export function resolveBaseline(name: string, inputs: BaselineInputs): TrustedBaseline {
  const recorded = inputs.recorded.find((row) => row.package === name);
  if (recorded) {
    return {
      package: name,
      version: recorded.version,
      source: "recorded",
      evidence: `explicitly recorded on ${recorded.recordedAt}`,
      recordedAt: recorded.recordedAt,
    };
  }

  const fromReceipt = inputs.receipts.get(name);
  if (fromReceipt) {
    return {
      package: name,
      version: fromReceipt,
      source: "receipt",
      evidence: "the version a verified warden transaction installed",
    };
  }

  const installed = inputs.installed.get(name);
  if (installed) {
    return {
      package: name,
      version: installed.version,
      source: "lockfile",
      evidence: "the version this project is actually running",
    };
  }

  if (inputs.previousRelease) {
    return {
      package: name,
      version: inputs.previousRelease,
      source: "previous-release",
      evidence: "the previous published release; weaker, because an attacker can publish twice",
    };
  }

  return {
    package: name,
    version: "",
    source: "none",
    evidence: "no trusted version of this package is known here",
  };
}

export function isUpgrade(baseline: TrustedBaseline, version: string): boolean {
  if (!baseline.version) return true;
  return compareVersions(version, baseline.version) > 0;
}

export function baselineStrength(source: BaselineSource): "strong" | "moderate" | "weak" | "none" {
  if (source === "recorded" || source === "receipt") return "strong";
  if (source === "lockfile") return "moderate";
  if (source === "previous-release") return "weak";
  return "none";
}
