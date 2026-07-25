import { parseSpec } from "../../engine.ts";
import { type ComparisonRow, compareRow, rankComparison } from "../../explain/report.ts";
import { collectApprovals, findApproval } from "../../graph/approvals.ts";
import { readInstalledGraph } from "../../graph/installed.ts";
import { LIFECYCLE_HOOKS } from "../../graph/resolve.ts";
import { fetchPackument, type PackageMeta, resolvePackage } from "../../registry.ts";
import { EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { isQuiet } from "../../shared/output.ts";
import { LABEL } from "./verdict-label.ts";

async function metaOrNull(name: string, version: string): Promise<PackageMeta | null> {
  try {
    return await resolvePackage(name, version);
  } catch {
    return null;
  }
}

export function renderComparison(rows: ComparisonRow[]): string {
  const lines = ["", bold("Candidate comparison"), ""];
  for (const row of rows) {
    lines.push(`  ${LABEL[row.decision]}  ${bold(`${row.package}@${row.version}`)}`);
    const facts = [
      row.weeklyDownloads === undefined
        ? "downloads unknown"
        : `${row.weeklyDownloads.toLocaleString("en-US")} weekly downloads`,
      row.ageDays === undefined ? "age unknown" : `${row.ageDays} days old`,
      row.hasProvenance ? "provenance attested" : "no provenance",
      row.installScripts.length
        ? `install scripts: ${row.installScripts.join(", ")}`
        : "no install scripts",
    ];
    if (row.deprecated) facts.push("deprecated");
    lines.push(`      ${dim(facts.join(" · "))}`);
    lines.push(`      ${row.summary}`);
  }
  lines.push("");
  lines.push(
    dim("  ordered by evidence, not by preference. warden never installs an alternative for you."),
  );
  lines.push("");
  return lines.join("\n");
}

export async function runWardenCompare(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const specs = argv.filter((arg) => !arg.startsWith("-"));
  if (specs.length < 2) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_COMPARE_USAGE",
      "at least two packages are needed to compare",
      "warden compare jscodeshift react-codemod",
    );
  }

  const rows: ComparisonRow[] = [];
  for (const spec of specs) {
    const parsed = parseSpec(spec);
    let verdict = null;
    try {
      verdict = await deps.check(spec);
    } catch {
      verdict = null;
    }
    rows.push(
      compareRow(verdict, await metaOrNull(parsed.name, parsed.version ?? "latest"), parsed.name),
    );
  }

  const ranked = rankComparison(rows);
  if (wantsJson) deps.stdout(`${JSON.stringify({ schema_version: 1, candidates: ranked })}\n`);
  else if (!isQuiet()) deps.stderr(renderComparison(ranked));
  return EXIT.allow;
}

export interface PendingScript {
  package: string;
  version: string;
  hooks: string[];
  approved: boolean;
}

export async function runWardenScripts(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  const verb = argv.find((arg) => !arg.startsWith("-"));
  if (verb && verb !== "pending") {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_SCRIPTS_USAGE",
      `unknown scripts command "${verb}"`,
      "run warden scripts pending",
    );
  }

  const root = deps.cwd();
  const installed = readInstalledGraph({ exists: deps.exists, readFile: deps.readFile }, root);
  const approvals = collectApprovals(deps, root, deps.home);
  const pending: PendingScript[] = [];

  for (const [name, node] of installed.nodes) {
    const hooks = node.hooks ?? [];
    if (!hooks.length) continue;
    const packument = await fetchPackument(name).catch(() => null);
    const meta = packument?.versions?.[node.version];
    const unapproved = hooks.filter(
      (hook) =>
        LIFECYCLE_HOOKS.includes(hook) &&
        !findApproval(approvals, {
          package: name,
          version: node.version,
          integrity: meta?.dist?.integrity ?? "",
          hook,
          script: meta?.scripts?.[hook] ?? "",
        }),
    );
    pending.push({
      package: name,
      version: node.version,
      hooks: unapproved.length ? unapproved : hooks,
      approved: unapproved.length === 0,
    });
  }

  pending.sort((a, b) => a.package.localeCompare(b.package));
  const waiting = pending.filter((entry) => !entry.approved);

  if (wantsJson) {
    deps.stdout(
      `${JSON.stringify({ schema_version: 1, source: installed.source, scripts: pending })}\n`,
    );
    return waiting.length ? EXIT.warn : EXIT.allow;
  }
  if (isQuiet()) return waiting.length ? EXIT.warn : EXIT.allow;

  const lines = ["", bold("Install scripts in the current graph"), ""];
  if (!pending.length) lines.push(dim("  no installed package declares a lifecycle script"));
  for (const entry of pending) {
    lines.push(
      `  ${entry.approved ? c("32", "approved") : c("33", "pending ")}  ${entry.package}@${entry.version}  ${dim(entry.hooks.join(", "))}`,
    );
    if (!entry.approved)
      lines.push(
        dim(
          `      warden approve-script ${entry.package}@${entry.version} --hook ${entry.hooks[0]}`,
        ),
      );
  }
  lines.push("");
  lines.push(dim(`  read from ${installed.source === "none" ? "no lockfile" : installed.source}`));
  lines.push("");
  deps.stderr(lines.join("\n"));
  return waiting.length ? EXIT.warn : EXIT.allow;
}
