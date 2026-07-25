import { join } from "node:path";
import { ANALYZER_VERSION, EXIT } from "../../schema.ts";
import { bold, c, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { detectManager } from "../../shared/manager.ts";
import { isQuiet } from "../../shared/output.ts";
import { COVERAGE_MATRIX, UNSUPPORTED_PATHS } from "../../shim/grammar.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export interface IntegrationCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface IntegrationsReport {
  schema_version: 1;
  version: string;
  checks: IntegrationCheck[];
  protected_commands: number;
  unmediated_paths: number;
  healthy: boolean;
}

const SHIMMED = ["npm", "pnpm", "yarn", "bun", "npx", "bunx"];

function readJson<T>(deps: WardenDeps, path: string): T | null {
  try {
    return JSON.parse(deps.readFile(path)) as T;
  } catch {
    return null;
  }
}

export function collectIntegrations(deps: WardenDeps): IntegrationsReport {
  const checks: IntegrationCheck[] = [];
  const home = deps.home;
  const shimDir = join(home, ".warden", "shims");

  checks.push({
    name: "binary",
    status: "ok",
    detail: `warden ${ANALYZER_VERSION}`,
  });

  const shimsInstalled = deps.exists(shimDir);
  checks.push({
    name: "shims installed",
    status: shimsInstalled ? "ok" : "warn",
    detail: shimsInstalled ? shimDir : "no shim directory",
    ...(shimsInstalled ? {} : { fix: "re-run the installer to place the shims" }),
  });

  const pathEntries = (process.env.PATH ?? "").split(":");
  const shimFirst = pathEntries.indexOf(shimDir);
  if (shimsInstalled) {
    checks.push({
      name: "shim precedence",
      status: shimFirst === 0 ? "ok" : shimFirst > 0 ? "warn" : "fail",
      detail:
        shimFirst === 0
          ? "the shim directory is first on PATH"
          : shimFirst > 0
            ? `the shim directory is position ${shimFirst + 1} on PATH`
            : "the shim directory is not on PATH",
      ...(shimFirst === 0
        ? {}
        : { fix: "restart the shell, or move the warden shim directory earlier on PATH" }),
    });
  }

  for (const tool of SHIMMED) {
    const shimmed = shimsInstalled && deps.exists(join(shimDir, tool));
    const real = deps.which(tool);
    if (!real && !shimmed) continue;
    checks.push({
      name: `intercept ${tool}`,
      status: shimmed ? "ok" : "info",
      detail: shimmed ? `shim present, real binary ${real ?? "not found"}` : "not shimmed",
      ...(shimmed ? {} : { fix: `re-run the installer and select ${tool}` }),
    });
  }

  const config = readJson<{
    intercept?: { install?: boolean; exec?: boolean };
    agent?: { name?: string };
  }>(deps, join(home, ".warden", "config.json"));
  const install = config?.intercept?.install !== false;
  const exec = config?.intercept?.exec !== false;
  checks.push({
    name: "interception",
    status: install && exec ? "ok" : "warn",
    detail: `install ${install ? "on" : "off"}, exec ${exec ? "on" : "off"}`,
    ...(install && exec ? {} : { fix: "warden config intercept on" }),
  });

  checks.push({
    name: "agent adapter",
    status: config?.agent?.name ? "ok" : "info",
    detail: config?.agent?.name ?? "not set; warden handoff defaults to claude",
    ...(config?.agent?.name ? {} : { fix: "warden config agent <name>" }),
  });

  const detection = detectManager(
    { readFile: deps.readFile, exists: deps.exists, which: deps.which },
    deps.cwd(),
  );
  checks.push({
    name: "project manager",
    status: detection.source === "default" || detection.source === "available" ? "warn" : "ok",
    detail: `${detection.manager} (${detection.evidence})`,
    ...(detection.source === "default" || detection.source === "available"
      ? { fix: "add a packageManager field or commit a lockfile so the manager is unambiguous" }
      : {}),
  });

  const workflow = deps.exists(join(deps.cwd(), ".github", "workflows", "warden.yml"));
  checks.push({
    name: "ci workflow",
    status: workflow ? "ok" : "info",
    detail: workflow ? ".github/workflows/warden.yml" : "no warden workflow found",
    ...(workflow ? {} : { fix: "warden init" }),
  });

  const failed = checks.some((check) => check.status === "fail");
  return {
    schema_version: 1,
    version: ANALYZER_VERSION,
    checks,
    protected_commands: COVERAGE_MATRIX.length,
    unmediated_paths: UNSUPPORTED_PATHS.length,
    healthy: !failed,
  };
}

const GLYPH: Record<CheckStatus, string> = {
  ok: c("32", "ok  "),
  warn: c("33", "warn"),
  fail: c("31", "fail"),
  info: dim("info"),
};

export function renderIntegrations(report: IntegrationsReport): string {
  const lines: string[] = ["", bold(`Warden integrations — ${report.version}`), ""];
  for (const check of report.checks) {
    lines.push(`  ${GLYPH[check.status]}  ${check.name.padEnd(20)} ${check.detail}`);
    if (check.fix) lines.push(`        ${dim(`fix: ${check.fix}`)}`);
  }
  lines.push("");
  lines.push(
    dim(
      `  ${report.protected_commands} mediated command forms, ${report.unmediated_paths} documented paths that are not mediated`,
    ),
  );
  lines.push(dim("  run warden coverage for the full matrix"));
  lines.push("");
  return lines.join("\n");
}

export function runWardenIntegrations(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  const verb = argv.find((arg) => !arg.startsWith("-"));
  if (verb && verb !== "doctor") {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_INTEGRATIONS_USAGE",
      `unknown integrations command "${verb}"`,
      "run warden integrations doctor",
    );
  }

  const report = collectIntegrations(deps);
  if (wantsJson) deps.stdout(`${JSON.stringify(report)}\n`);
  else if (!isQuiet()) deps.stderr(renderIntegrations(report));
  return report.healthy ? EXIT.allow : EXIT.error;
}
