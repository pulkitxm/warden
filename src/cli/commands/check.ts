import { parseArgs } from "node:util";
import { auditConfig } from "../../audit/config.ts";
import { auditLockfile } from "../../audit/lockfile.ts";
import { auditScripts } from "../../audit/scripts.ts";
import type { AuditFs, AuditReport } from "../../audit/types.ts";
import { worstLevel } from "../../audit/types.ts";
import { exitCodeFor } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { renderAuditReport, renderLine, renderVerdict } from "../ui.ts";

export const CHECK_SURFACES = ["lockfile", "scripts", "config"] as const;

export type CheckSurface = (typeof CHECK_SURFACES)[number];

function auditFsOf(deps: WardenDeps): AuditFs {
  return { readFile: deps.readFile, exists: deps.exists, glob: deps.glob };
}

export function runSurfaceAudit(surface: CheckSurface, dir: string, deps: WardenDeps): AuditReport {
  const fs = auditFsOf(deps);
  if (surface === "lockfile") return auditLockfile(dir, fs);
  if (surface === "scripts") return auditScripts(dir, fs);
  return auditConfig(dir, deps.home, fs);
}

export async function runWardenCheck(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        json: { type: "boolean" },
        "allow-risky": { type: "boolean" },
        dir: { type: "string" },
      },
      allowPositionals: true,
    });
    const surface = CHECK_SURFACES.find((name) => name === positionals[0]);
    if (surface) {
      if (positionals.length > 1) {
        return wardenFailure(
          deps,
          Boolean(values.json),
          "usage",
          "WARDEN_CHECK_SURFACE_ARGS",
          `check ${surface} takes no further positional arguments`,
          "run warden check --help",
        );
      }
      const report = runSurfaceAudit(surface, values.dir ?? deps.cwd(), deps);
      if (values.json) deps.stdout(`${JSON.stringify(report)}\n`);
      else if (!isQuiet()) deps.stderr(renderAuditReport(report));
      const level = worstLevel(report.findings);
      return exitCodeFor(level === "block" && values["allow-risky"] ? "warn" : level);
    }
    if (!positionals.length) {
      return wardenFailure(
        deps,
        Boolean(values.json),
        "usage",
        "WARDEN_MISSING_PACKAGE",
        "check requires at least one package",
        `run warden check <pkg>, or a surface: ${CHECK_SURFACES.join(", ")}`,
      );
    }
    const verdicts = await Promise.all(positionals.map((spec) => deps.check(spec)));
    if (values.json) {
      deps.stdout(`${JSON.stringify(verdicts.length === 1 ? verdicts[0] : verdicts)}\n`);
    } else if (!isQuiet()) {
      if (verdicts.length === 1) deps.stderr(renderVerdict(verdicts[0]!));
      else for (const verdict of verdicts) deps.stderr(`${renderLine(verdict)}\n`);
    }
    const level = verdicts.some((v) => v.verdict === "block")
      ? "block"
      : verdicts.some((v) => v.verdict === "warn")
        ? "warn"
        : "allow";
    return exitCodeFor(level === "block" && values["allow-risky"] ? "warn" : level);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_ANALYSIS_ERROR",
      (error as Error).message,
      "retry the check or verify the package spec and registry connection",
    );
  }
}
