import {
  baselineStrength,
  readBaselines,
  recordBaseline,
  resolveBaseline,
  type TrustedBaseline,
} from "../../baseline/trusted.ts";
import { parseSpec } from "../../engine.ts";
import { readInstalledGraph } from "../../graph/installed.ts";
import { EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { readReceipt } from "./verify.ts";

const STRENGTH_COLOR: Record<string, string> = {
  strong: "32",
  moderate: "33",
  weak: "31",
  none: "90",
};

function receiptVersions(deps: WardenDeps, root: string): Map<string, string> {
  const receipt = readReceipt(deps, root);
  if (receipt?.result !== "applied") return new Map();
  return new Map(
    receipt.artifacts
      .filter((artifact) => artifact.verdict === "allow")
      .map((artifact) => [artifact.package, artifact.version]),
  );
}

export function baselinesFor(deps: WardenDeps, root: string, names: string[]): TrustedBaseline[] {
  const installed = readInstalledGraph({ exists: deps.exists, readFile: deps.readFile }, root);
  const inputs = {
    recorded: readBaselines(deps, root),
    installed: installed.nodes,
    receipts: receiptVersions(deps, root),
  };
  return names.map((name) => resolveBaseline(name, inputs));
}

export function renderBaselines(baselines: TrustedBaseline[]): string {
  const lines = ["", bold("Trusted baselines"), ""];
  if (!baselines.length) lines.push(dim("  no baseline is known for any package in this project"));
  for (const baseline of baselines) {
    const strength = baselineStrength(baseline.source);
    lines.push(
      `  ${c(STRENGTH_COLOR[strength] as string, strength.padEnd(8))} ${baseline.package.padEnd(28)} ${baseline.version || "unknown"}`,
    );
    lines.push(`           ${dim(baseline.evidence)}`);
  }
  lines.push("");
  lines.push(
    dim(
      "  a recorded or receipt-backed baseline is what a delta should be measured against; the previous published release is the weak fallback",
    ),
  );
  lines.push("");
  return lines.join("\n");
}

export function runWardenBaseline(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const verb = positional[0] ?? "list";

  if (verb === "list") {
    const installed = readInstalledGraph({ exists: deps.exists, readFile: deps.readFile }, root);
    const recorded = readBaselines(deps, root);
    const names = [
      ...new Set([...recorded.map((row) => row.package), ...installed.nodes.keys()]),
    ].sort();
    const baselines = baselinesFor(deps, root, names);
    if (wantsJson) {
      deps.stdout(`${JSON.stringify({ schema_version: 1, baselines })}\n`);
      return EXIT.allow;
    }
    if (!isQuiet()) deps.stderr(renderBaselines(baselines));
    return EXIT.allow;
  }

  if (verb === "record") {
    const spec = positional[1];
    if (!spec?.includes("@")) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_BASELINE_USAGE",
        "an exact package@version is required",
        "warden baseline record left-pad@1.3.0",
      );
    }
    const parsed = parseSpec(spec);
    if (!parsed.version) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_BASELINE_USAGE",
        "a baseline must name an exact version, not a range",
        "warden baseline record left-pad@1.3.0",
      );
    }

    const noteIndex = argv.indexOf("--note");
    const entry = {
      package: parsed.name,
      version: parsed.version,
      recordedAt: new Date().toISOString(),
      ...(noteIndex === -1 ? {} : { note: argv[noteIndex + 1] as string }),
    };

    try {
      recordBaseline(deps, root, entry);
    } catch (error) {
      return wardenFailure(
        deps,
        wantsJson,
        "config",
        "WARDEN_BASELINE_WRITE",
        `the baseline could not be written: ${(error as Error).message}`,
        "check that the .warden directory is writable",
      );
    }

    if (wantsJson) deps.stdout(`${JSON.stringify(entry)}\n`);
    else if (!isQuiet())
      deps.stderr(
        `\nrecorded ${entry.package}@${entry.version} as a trusted baseline\n  ${dim("a future release will be compared against this rather than against whatever was published before it")}\n\n`,
      );
    return EXIT.allow;
  }

  return wardenFailure(
    deps,
    wantsJson,
    "usage",
    "WARDEN_BASELINE_VERB",
    `unknown baseline command "${verb}"`,
    "run warden baseline list or warden baseline record <pkg@version>",
  );
}
