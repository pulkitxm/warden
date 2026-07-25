import { runDoctor } from "../../doctor/index.ts";
import { EXIT } from "../../schema.ts";
import { parseArgsSafe } from "../../shared/args.ts";
import type { RunDeps, WardenDeps } from "../../shared/deps.ts";
import { guarded, wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { renderDoctorReport } from "../ui.ts";

const DOCTOR_OPTIONS = {
  json: { type: "boolean" },
  "no-apply": { type: "boolean" },
  "no-verify": { type: "boolean" },
  dir: { type: "string" },
  help: { type: "boolean" },
} as const;

export async function runDoctorCommand(
  tool: string,
  values: { json?: boolean; "no-apply"?: boolean; "no-verify"?: boolean; dir?: string },
  deps: RunDeps,
): Promise<number> {
  return guarded(tool, deps, async () => {
    const doctor = deps.doctor ?? runDoctor;
    const report = await doctor(values.dir ?? ".", {
      apply: !values["no-apply"],
      ...(values["no-verify"] ? { verify: false } : {}),
    });
    if (values.json) deps.stdout(`${JSON.stringify(report)}\n`);
    else if (!isQuiet()) deps.stderr(renderDoctorReport(report, tool));
    if (!report.issues.length) {
      return report.audited === 0 && report.skipped > 0 ? EXIT.error : 0;
    }
    const plan = report.plans.find((p) => p.id === report.recommended);
    const fixed = new Set(report.applied ? (plan?.changes ?? []).map((c) => c.name) : []);
    return report.issues.every((i) => fixed.has(i.name)) ? 0 : EXIT.warn;
  });
}

export async function runWardenDoctor(argv: string[], deps: WardenDeps): Promise<number> {
  const parsed = parseArgsSafe({ args: argv, options: DOCTOR_OPTIONS, allowPositionals: true });
  if (!parsed || parsed.positionals.length) {
    return wardenFailure(
      deps,
      argv.includes("--json"),
      "usage",
      "WARDEN_DOCTOR_USAGE",
      "doctor takes no positional arguments",
      "run warden doctor --help",
    );
  }
  return runDoctorCommand("warden doctor", parsed.values, deps);
}
