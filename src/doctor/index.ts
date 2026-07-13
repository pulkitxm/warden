import { checkPackage } from "../engine.ts";
import { type Blocklist, defaultBlocklist } from "../intel/index.ts";
import { resolvePackage } from "../registry.ts";
import type { Verdict, VerdictLevel } from "../schema.ts";
import { minSatisfying } from "../semver.ts";
import { fetchVulns, type OsvVuln } from "../vuln.ts";
import {
  type Change,
  candidateOrder,
  changeFor,
  type DepAudit,
  type Issue,
  issuesOf,
  sameChanges,
} from "./plan.ts";
import { loadProject, type ProjectDependency, type ProjectFs } from "./project.ts";
import {
  applyPlan,
  availablePm,
  defaultVerifyDeps,
  type StepResult,
  type VerifyDeps,
  verifyPlan,
} from "./verify.ts";

export interface GateRecord {
  name: string;
  version: string;
  verdict: VerdictLevel;
  categories: string[];
  summary: string;
}

export interface PlanReport {
  id: string;
  label: string;
  changes: Change[];
  verification?: { passed: boolean; steps: StepResult[] };
}

export interface UnfixableRecord {
  name: string;
  reason: string;
}

export interface DoctorReport {
  schema_version: 1;
  project: string;
  issues: Issue[];
  gate: GateRecord[];
  unfixable: UnfixableRecord[];
  plans: PlanReport[];
  recommended?: string;
  applied?: boolean;
  notes: string[];
}

export interface DoctorOptions {
  verify?: boolean;
  apply?: boolean;
}

export interface DoctorDeps {
  fs?: ProjectFs;
  resolve?: typeof resolvePackage;
  vulns?: (name: string) => Promise<OsvVuln[] | null>;
  check?: (spec: string) => Promise<Verdict>;
  verifier?: VerifyDeps;
  blocklist?: Blocklist;
}

const GATE_ATTEMPTS = 3;

async function auditDependency(
  dep: ProjectDependency,
  resolve: typeof resolvePackage,
  vulnsFn: (name: string) => Promise<OsvVuln[] | null>,
  blocklist: Blocklist,
  notes: string[],
): Promise<DepAudit | null> {
  let meta: Awaited<ReturnType<typeof resolvePackage>>;
  try {
    meta = await resolve(dep.name);
  } catch (e) {
    notes.push(`${dep.name}: registry lookup failed (${(e as Error).message}); skipped`);
    return null;
  }
  if (!meta.existsOnRegistry) {
    notes.push(`${dep.name}: not found on the registry; skipped`);
    return null;
  }
  const installed = dep.installed ?? minSatisfying(meta.versions, dep.range);
  if (!installed) {
    notes.push(`${dep.name}: no installed version matches range "${dep.range}"; skipped`);
  }
  const vulns = await vulnsFn(dep.name);
  if (vulns === null) {
    notes.push(`${dep.name}: advisory lookup failed; treating vulnerabilities as unknown`);
  }
  const hit = installed ? blocklist.match(dep.name, installed) : null;
  return {
    name: dep.name,
    range: dep.range,
    group: dep.group,
    installed,
    versions: meta.versions,
    vulns: vulns ?? [],
    deprecated: Boolean(meta.deprecated),
    blocklistId: hit?.id,
    notes: [],
  };
}

async function selectCandidate(
  audit: DepAudit,
  direction: "minimal" | "latest",
  check: (spec: string) => Promise<Verdict>,
  gates: Map<string, GateRecord>,
): Promise<string | undefined> {
  for (const version of candidateOrder(audit, direction).slice(0, GATE_ATTEMPTS)) {
    const key = `${audit.name}@${version}`;
    let rec = gates.get(key);
    if (!rec) {
      const verdict = await check(key);
      rec = {
        name: audit.name,
        version,
        verdict: verdict.verdict,
        categories: verdict.categories,
        summary: verdict.summary,
      };
      gates.set(key, rec);
    }
    if (rec.verdict !== "block") return version;
  }
  return undefined;
}

export async function runDoctor(
  dir: string,
  opts: DoctorOptions = {},
  deps: DoctorDeps = {},
): Promise<DoctorReport> {
  const resolve = deps.resolve ?? resolvePackage;
  const vulnsFn = deps.vulns ?? fetchVulns;
  const check = deps.check ?? ((spec: string) => checkPackage(spec));
  const verifier = deps.verifier ?? defaultVerifyDeps;
  const blocklist = deps.blocklist ?? defaultBlocklist;

  const project = loadProject(dir, deps.fs);
  const notes: string[] = [];
  const audits: DepAudit[] = [];
  for (const dep of project.deps) {
    const audit = await auditDependency(dep, resolve, vulnsFn, blocklist, notes);
    if (audit) audits.push(audit);
  }

  const gates = new Map<string, GateRecord>();
  for (const audit of audits) {
    if (!audit.installed || audit.blocklistId) continue;
    const key = `${audit.name}@${audit.installed}`;
    try {
      const verdict = await check(key);
      const rec: GateRecord = {
        name: audit.name,
        version: audit.installed,
        verdict: verdict.verdict,
        categories: verdict.categories,
        summary: verdict.summary,
      };
      gates.set(key, rec);
      if (rec.verdict === "block") audit.installedBlocked = rec.summary;
    } catch (e) {
      notes.push(`${key}: installed-version gate check failed (${(e as Error).message})`);
    }
  }

  const issues = audits.flatMap(issuesOf);
  const unfixable: UnfixableRecord[] = [];
  const minimalChanges: Change[] = [];
  const latestChanges: Change[] = [];

  for (const audit of audits) {
    const needsFix = issues.some(
      (i) => i.name === audit.name && (i.kind === "vulnerability" || i.kind === "compromised"),
    );
    if (!needsFix) continue;
    if (!candidateOrder(audit, "minimal").length) {
      unfixable.push({
        name: audit.name,
        reason: "no published version fixes the reported issues",
      });
      continue;
    }
    const minimal = await selectCandidate(audit, "minimal", check, gates);
    const latest = await selectCandidate(audit, "latest", check, gates);
    const minimalPick = minimal ?? latest;
    if (!minimalPick) {
      unfixable.push({
        name: audit.name,
        reason: "every candidate fix was blocked by the supply-chain gate",
      });
      continue;
    }
    minimalChanges.push(changeFor(audit, minimalPick));
    latestChanges.push(changeFor(audit, latest ?? minimalPick));
  }

  const plans: PlanReport[] = [];
  if (minimalChanges.length) {
    plans.push({ id: "minimal", label: "smallest safe upgrade", changes: minimalChanges });
    if (!sameChanges(minimalChanges, latestChanges)) {
      plans.push({ id: "latest", label: "most current safe versions", changes: latestChanges });
    }
  }

  let recommended: string | undefined;
  const pm = availablePm(project, verifier);
  if (plans.length) {
    if (opts.verify === false) {
      recommended = plans[0]?.id;
    } else if (!pm) {
      notes.push("no package manager (bun or npm) found on PATH; verification skipped");
      recommended = plans[0]?.id;
    } else {
      for (const plan of plans) {
        const result = verifyPlan(project, plan.changes, verifier);
        plan.verification = { passed: result.passed, steps: result.steps };
      }
      recommended = plans.find((p) => p.verification?.passed)?.id;
    }
  }

  let applied: boolean | undefined;
  const recommendedPlan = plans.find((p) => p.id === recommended);
  if (opts.apply && recommendedPlan) {
    if (pm) {
      applied = applyPlan(project, recommendedPlan.changes, verifier).applied;
    } else {
      applied = false;
      notes.push("cannot apply: no package manager (bun or npm) found on PATH");
    }
  }

  return {
    schema_version: 1,
    project: project.name,
    issues,
    gate: [...gates.values()],
    unfixable,
    plans,
    recommended,
    applied,
    notes,
  };
}
