import type { PackageManager } from "../shared/manager.ts";

export interface WardenPolicy {
  scripts?: "deny" | "approved" | "allow";
  minimumReleaseAgeDays?: number;
  exoticSources?: "block" | "allow";
  lockfile?: "trust" | "reverify";
  downgrades?: "block" | "allow";
}

export interface CompiledSetting {
  file: string;
  key: string;
  value: string;
  note: string;
}

export interface CompiledPolicy {
  manager: PackageManager;
  settings: CompiledSetting[];
  enforcedByWarden: string[];
  unsupported: Array<{ intent: string; reason: string }>;
}

export const DEFAULT_POLICY: Required<WardenPolicy> = {
  scripts: "approved",
  minimumReleaseAgeDays: 1,
  exoticSources: "block",
  lockfile: "reverify",
  downgrades: "block",
};

export function resolvePolicy(policy: WardenPolicy | undefined): Required<WardenPolicy> {
  return { ...DEFAULT_POLICY, ...policy };
}

function compileNpm(policy: Required<WardenPolicy>): CompiledPolicy {
  const settings: CompiledSetting[] = [];
  const unsupported: CompiledPolicy["unsupported"] = [];

  if (policy.scripts !== "allow") {
    settings.push({
      file: ".npmrc",
      key: "ignore-scripts",
      value: "true",
      note: "npm runs no dependency lifecycle script unless warden approves and runs it",
    });
  }
  if (policy.minimumReleaseAgeDays > 0) {
    settings.push({
      file: ".npmrc",
      key: "minimum-release-age",
      value: `${policy.minimumReleaseAgeDays * 1440}`,
      note: "a freshly published version cannot be installed immediately",
    });
  }
  if (policy.exoticSources === "block") {
    for (const key of ["allow-git", "allow-remote"]) {
      settings.push({
        file: ".npmrc",
        key,
        value: "false",
        note: "git and url dependencies have no registry provenance to check",
      });
    }
  }
  if (policy.downgrades === "block")
    unsupported.push({
      intent: "block version downgrades",
      reason: "npm has no native downgrade policy",
    });

  return {
    manager: "npm",
    settings,
    enforcedByWarden: enforced(policy, unsupported),
    unsupported,
  };
}

function compilePnpm(policy: Required<WardenPolicy>): CompiledPolicy {
  const settings: CompiledSetting[] = [];
  if (policy.scripts !== "allow") {
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "strictDepBuilds",
      value: "true",
      note: "an unapproved dependency build fails the install rather than being skipped quietly",
    });
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "allowBuilds",
      value: "[]",
      note: "no dependency may build until warden records an approval for it",
    });
  }
  if (policy.minimumReleaseAgeDays > 0) {
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "minimumReleaseAge",
      value: `${policy.minimumReleaseAgeDays * 1440}`,
      note: "applies to direct and transitive dependencies",
    });
  }
  if (policy.exoticSources === "block") {
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "blockExoticSubdeps",
      value: "true",
      note: "a transitive git or url dependency is rejected",
    });
  }
  if (policy.lockfile === "reverify") {
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "trustLockfile",
      value: "false",
      note: "the lockfile is re-verified against the registry rather than trusted as written",
    });
  }
  if (policy.downgrades === "block") {
    settings.push({
      file: "pnpm-workspace.yaml",
      key: "trustPolicy",
      value: "no-downgrade",
      note: "a resolution may not move a package backwards",
    });
  }
  return { manager: "pnpm", settings, enforcedByWarden: enforced(policy, []), unsupported: [] };
}

function compileYarn(policy: Required<WardenPolicy>): CompiledPolicy {
  const settings: CompiledSetting[] = [];
  const unsupported: CompiledPolicy["unsupported"] = [];

  if (policy.scripts !== "allow") {
    settings.push({
      file: ".yarnrc.yml",
      key: "enableScripts",
      value: "false",
      note: "yarn 4.14 and later already default to this; setting it makes the policy explicit",
    });
  }
  if (policy.minimumReleaseAgeDays > 0) {
    settings.push({
      file: ".yarnrc.yml",
      key: "minimumReleaseAge",
      value: `${policy.minimumReleaseAgeDays * 1440}`,
      note: "yarn 4.12 and later gate freshly published versions",
    });
  }
  if (policy.lockfile === "reverify") {
    settings.push({
      file: ".yarnrc.yml",
      key: "enableHardenedMode",
      value: "true",
      note: "resolutions and lockfile metadata are re-checked",
    });
  }
  if (policy.exoticSources === "block")
    unsupported.push({
      intent: "block git and url sources",
      reason: "yarn has no single native switch; warden blocks these at the shim and in the plan",
    });
  if (policy.downgrades === "block")
    unsupported.push({
      intent: "block version downgrades",
      reason: "yarn has no native downgrade policy",
    });

  return {
    manager: "yarn",
    settings,
    enforcedByWarden: enforced(policy, unsupported),
    unsupported,
  };
}

function compileBun(policy: Required<WardenPolicy>): CompiledPolicy {
  const settings: CompiledSetting[] = [];
  const unsupported: CompiledPolicy["unsupported"] = [];

  if (policy.scripts !== "allow") {
    settings.push({
      file: "package.json",
      key: "trustedDependencies",
      value: "[]",
      note: "bun runs no dependency lifecycle script outside this list",
    });
  }
  for (const [intent, enabled] of [
    ["enforce a minimum release age", policy.minimumReleaseAgeDays > 0],
    ["block git and url sources", policy.exoticSources === "block"],
    ["re-verify the lockfile", policy.lockfile === "reverify"],
    ["block version downgrades", policy.downgrades === "block"],
  ] as const) {
    if (enabled)
      unsupported.push({
        intent,
        reason: "bun has no native setting; warden enforces this itself",
      });
  }

  return { manager: "bun", settings, enforcedByWarden: enforced(policy, unsupported), unsupported };
}

function enforced(
  policy: Required<WardenPolicy>,
  unsupported: CompiledPolicy["unsupported"],
): string[] {
  const gaps = unsupported.map((entry) => entry.intent);
  const out = [
    "every added or changed package is vetted before the install runs",
    "install scripts require an approval bound to version, integrity, hook, and script body",
  ];
  if (policy.exoticSources === "block" && gaps.includes("block git and url sources"))
    out.push("git and url sources are blocked by the shim and reported by the plan");
  if (policy.minimumReleaseAgeDays > 0 && gaps.includes("enforce a minimum release age"))
    out.push(`a release younger than ${policy.minimumReleaseAgeDays} day(s) is reported as a risk`);
  if (policy.lockfile === "reverify" && gaps.includes("re-verify the lockfile"))
    out.push("the lockfile audit checks where every dependency actually resolves from");
  if (policy.downgrades === "block" && gaps.includes("block version downgrades"))
    out.push("a downgrade is visible in the plan as a version move");
  return out;
}

const COMPILERS: Record<PackageManager, (policy: Required<WardenPolicy>) => CompiledPolicy> = {
  npm: compileNpm,
  pnpm: compilePnpm,
  yarn: compileYarn,
  bun: compileBun,
};

export function compilePolicy(
  manager: PackageManager,
  policy: WardenPolicy | undefined,
): CompiledPolicy {
  return COMPILERS[manager](resolvePolicy(policy));
}
