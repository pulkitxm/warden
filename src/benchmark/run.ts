import { buildPlan, type PlanDecision, type PlanDeps } from "../graph/plan.ts";
import { type Packument, resolveGraph } from "../graph/resolve.ts";
import type { Verdict, VerdictLevel } from "../schema.ts";

export interface BenchmarkCase {
  id: string;
  shape: string;
  kind: "malicious" | "benign";
  packages: Record<
    string,
    {
      version: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      deprecated?: string;
    }
  >;
  verdicts?: Record<string, VerdictLevel>;
  installed?: Record<string, { version: string; hooks?: string[] }>;
  root: { name: string; range: string };
  expected: PlanDecision;
}

export interface CaseResult {
  id: string;
  shape: string;
  kind: BenchmarkCase["kind"];
  expected: PlanDecision;
  actual: PlanDecision;
  correct: boolean;
  coverage: number;
}

export interface BenchmarkReport {
  schema_version: 1;
  analyzer_version: string;
  totals: { cases: number; malicious: number; benign: number };
  detection: { caught: number; missed: number; rate: number };
  falsePositives: { count: number; rate: number };
  meanCoverage: number;
  results: CaseResult[];
  method: string[];
}

const STOPS: PlanDecision[] = ["block", "needs_approval"];

function verdictFor(name: string, version: string, level: VerdictLevel): Verdict {
  return {
    schema_version: 1,
    package: name,
    version,
    integrity: `sha512-${name}`,
    verdict: level,
    risk_score: level === "block" ? 90 : level === "warn" ? 40 : 0,
    categories: level === "block" ? ["known_malware"] : [],
    summary: level === "block" ? "known malicious release" : "no findings",
    evidence: [],
    analyzer_version: "benchmark",
    source: "heuristics",
  };
}

export function depsForCase(entry: BenchmarkCase): PlanDeps {
  return {
    resolve: resolveGraph,
    packument: async (name: string): Promise<Packument | null> => {
      const meta = entry.packages[name];
      if (!meta) return null;
      return {
        name,
        "dist-tags": { latest: meta.version },
        versions: {
          [meta.version]: {
            version: meta.version,
            ...(meta.dependencies ? { dependencies: meta.dependencies } : {}),
            ...(meta.optionalDependencies
              ? { optionalDependencies: meta.optionalDependencies }
              : {}),
            ...(meta.scripts ? { scripts: meta.scripts } : {}),
            ...(meta.deprecated ? { deprecated: meta.deprecated } : {}),
            dist: { tarball: `https://reg.test/${name}.tgz`, integrity: `sha512-${name}` },
          },
        },
      };
    },
    check: (spec) => {
      const at = spec.lastIndexOf("@");
      const name = spec.slice(0, at);
      return Promise.resolve(
        verdictFor(name, spec.slice(at + 1), entry.verdicts?.[name] ?? "allow"),
      );
    },
  };
}

export async function runCase(entry: BenchmarkCase): Promise<CaseResult> {
  const plan = await buildPlan(
    {
      command: `npm install ${entry.root.name}`,
      manager: "npm",
      root: "/benchmark",
      direct: [entry.root],
      existing: [],
      installed: {
        nodes: new Map(Object.entries(entry.installed ?? {})),
        source: entry.installed ? "package-lock.json" : "none",
      },
    },
    depsForCase(entry),
  );

  return {
    id: entry.id,
    shape: entry.shape,
    kind: entry.kind,
    expected: entry.expected,
    actual: plan.decision,
    correct: plan.decision === entry.expected,
    coverage: plan.coverage.ratio,
  };
}

export async function runBenchmark(
  cases: BenchmarkCase[],
  analyzerVersion: string,
): Promise<BenchmarkReport> {
  const results: CaseResult[] = [];
  for (const entry of cases) results.push(await runCase(entry));

  const malicious = results.filter((result) => result.kind === "malicious");
  const benign = results.filter((result) => result.kind === "benign");
  const caught = malicious.filter((result) => STOPS.includes(result.actual));
  const falsePositives = benign.filter((result) => STOPS.includes(result.actual));

  return {
    schema_version: 1,
    analyzer_version: analyzerVersion,
    totals: { cases: results.length, malicious: malicious.length, benign: benign.length },
    detection: {
      caught: caught.length,
      missed: malicious.length - caught.length,
      rate: malicious.length ? caught.length / malicious.length : 1,
    },
    falsePositives: {
      count: falsePositives.length,
      rate: benign.length ? falsePositives.length / benign.length : 0,
    },
    meanCoverage: results.length
      ? results.reduce((sum, result) => sum + result.coverage, 0) / results.length
      : 1,
    results,
    method: [
      "every case is driven through the real resolver and the real plan decision, not a mock",
      "a malicious case counts as caught only when the decision stops the install, which means block or needs_approval",
      "a benign case counts as a false positive when the decision stops the install",
      "coverage is the share of changed packages the plan actually analyzed",
      "these are curated shapes, not a sample of the registry; treat the rates as regression signals rather than as field accuracy",
    ],
  };
}
