export const ENGINE_VERSION = "0.1.0";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Recommendation = "allow" | "confirm_with_human" | "block";

export type Flag =
  | "typosquat"
  | "new_install_script"
  | "new_postinstall"
  | "suspicious_script_content"
  | "network_in_script"
  | "obfuscated"
  | "recent_publish"
  | "maintainer_changed"
  | "low_install_history"
  | "writes_agent_config"
  | "known_vulnerability"
  | "license_copyleft"
  | "deprecated"
  | (string & {});

export interface PackageMeta {
  name: string;
  version: string;
  versions: string[];
  previousVersion?: string;
  publishedAt?: string;
  ageDays?: number;
  maintainers: string[];
  previousMaintainers?: string[];
  tarballUrl?: string;
  previousTarballUrl?: string;
  weeklyDownloads?: number;
  deprecated?: string | false;
  repositoryUrl?: string;
  scripts?: Record<string, string>;
  previousScripts?: Record<string, string>;
}

export interface TarballFile {
  path: string;
  size: number;
  content?: string;
  binary?: boolean;
}

export interface TarballDiff {
  isNewPackage: boolean;
  addedFiles: TarballFile[];
  removedPaths: string[];
  changedFiles: TarballFile[];
  addedScripts: Record<string, string>;
  changedScripts: Record<string, string>;
  currentFiles: TarballFile[];
}

export interface Signal {
  flag: Flag;
  evidence: string;
  weight: number;
  requiresActionSignal?: boolean;
  isActionSignal?: boolean;
}

export interface Verdict {
  package: string;
  risk_score: number;
  level: RiskLevel;
  flags: Flag[];
  evidence: string[];
  explanation: string;
  recommendation: Recommendation;
  cached: boolean;
  engine_version: string;
  llm_used?: boolean;
}
