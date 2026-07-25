import { parseArgs } from "node:util";
import { exitCodeFor } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { renderLine, renderVerdict } from "../ui.ts";

export async function runWardenCheck(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" } },
      allowPositionals: true,
    });
    if (!positionals.length) {
      return wardenFailure(
        deps,
        Boolean(values.json),
        "usage",
        "WARDEN_MISSING_PACKAGE",
        "check requires at least one package",
        "run warden check --help",
      );
    }
    const verdicts = await Promise.all(positionals.map((spec) => deps.check(spec)));
    if (values.json) {
      deps.stdout(`${JSON.stringify(verdicts.length === 1 ? verdicts[0] : verdicts)}\n`);
    } else if (verdicts.length === 1) {
      deps.stderr(renderVerdict(verdicts[0]!));
    } else {
      for (const verdict of verdicts) deps.stderr(`${renderLine(verdict)}\n`);
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
