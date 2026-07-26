export interface ArtifactId {
  name: string;
  version: string;
  integrity?: string;
}

export type ApprovalRequirement =
  | { kind: "script"; artifact: ArtifactId; hook: string }
  | { kind: "coverage-budget"; unchecked: ArtifactId[] }
  | { kind: "graph-truncation"; analyzed: number; changed: number };

export type RequirementKind = ApprovalRequirement["kind"];

export const EXCEPTION_FLAG: Record<RequirementKind, string> = {
  script: "--skip-script-approval",
  "coverage-budget": "--allow-incomplete-analysis",
  "graph-truncation": "--allow-incomplete-analysis",
};

export function scriptRequirementsFor(
  changes: Array<{ name: string; version: string; newHooks: string[] }>,
  integrityOf: (name: string, version: string) => string | undefined = () => undefined,
): ApprovalRequirement[] {
  const out: ApprovalRequirement[] = [];
  for (const change of changes) {
    const integrity = integrityOf(change.name, change.version);
    for (const hook of change.newHooks)
      out.push({
        kind: "script",
        artifact: {
          name: change.name,
          version: change.version,
          ...(integrity ? { integrity } : {}),
        },
        hook,
      });
  }
  return out;
}

export function analysisRequirementsFor(
  artifacts: Array<{ package: string; version: string; integrity?: string; verdict: string }>,
  truncated: boolean,
  coverage: { analyzed: number; changed: number },
): ApprovalRequirement[] {
  const out: ApprovalRequirement[] = [];
  const unchecked = artifacts.filter((artifact) => artifact.verdict === "unchecked");
  if (unchecked.length) {
    out.push({
      kind: "coverage-budget",
      unchecked: unchecked.map((artifact) => ({
        name: artifact.package,
        version: artifact.version,
        ...(artifact.integrity ? { integrity: artifact.integrity } : {}),
      })),
    });
  }
  if (truncated)
    out.push({ kind: "graph-truncation", analyzed: coverage.analyzed, changed: coverage.changed });
  return out;
}

export function describeRequirement(requirement: ApprovalRequirement): string {
  if (requirement.kind === "script")
    return `${requirement.artifact.name}@${requirement.artifact.version} has a ${requirement.hook} script`;
  if (requirement.kind === "coverage-budget")
    return `${requirement.unchecked.length} changed packages were not analyzed in this plan`;
  return "the graph was truncated before it was fully resolved";
}

export function satisfyingAction(requirement: ApprovalRequirement, planId: string): string {
  if (requirement.kind === "script")
    return `warden approve-script ${requirement.artifact.name}@${requirement.artifact.version} --hook ${requirement.hook} --plan ${planId}`;
  return `warden apply ${planId} ${EXCEPTION_FLAG[requirement.kind]}`;
}

export function scriptRequirements(
  requirements: ApprovalRequirement[],
): Array<Extract<ApprovalRequirement, { kind: "script" }>> {
  return requirements.filter(
    (requirement): requirement is Extract<ApprovalRequirement, { kind: "script" }> =>
      requirement.kind === "script",
  );
}

export function analysisRequirements(requirements: ApprovalRequirement[]): ApprovalRequirement[] {
  return requirements.filter((requirement) => requirement.kind !== "script");
}
