import { EXIT } from "../../schema.ts";
import { bold, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { isQuiet } from "../../shared/output.ts";
import {
  COVERAGE_MATRIX,
  type Manager,
  planCommand,
  UNSUPPORTED_PATHS,
} from "../../shim/grammar.ts";

const MANAGERS: Manager[] = ["npm", "pnpm", "yarn", "bun", "npx", "bunx"];

export function runWardenShimPlan(argv: string[], deps: WardenDeps): number {
  const manager = argv[0] as Manager;
  if (!MANAGERS.includes(manager)) {
    deps.stdout(`${JSON.stringify({ kind: "passthrough", specs: [], exotic: [] })}\n`);
    return EXIT.allow;
  }
  deps.stdout(`${JSON.stringify(planCommand(manager, argv.slice(1)))}\n`);
  return EXIT.allow;
}

export function runWardenCoverage(argv: string[], deps: WardenDeps): number {
  if (argv.includes("--json")) {
    deps.stdout(
      `${JSON.stringify({ schema_version: 1, matrix: COVERAGE_MATRIX, unsupported: UNSUPPORTED_PATHS })}\n`,
    );
    return EXIT.allow;
  }
  if (isQuiet()) return EXIT.allow;

  const lines: string[] = ["", bold("Command coverage"), ""];
  for (const manager of ["npm", "pnpm", "yarn", "bun", "npx", "bunx"]) {
    const rows = COVERAGE_MATRIX.filter((row) => row.manager === manager);
    if (!rows.length) continue;
    lines.push(bold(`  ${manager}`));
    for (const row of rows) {
      lines.push(
        `    ${row.coverage.padEnd(10)} ${`${manager} ${row.command}`.padEnd(28)} ${dim(row.kind)}`,
      );
    }
    lines.push("");
  }

  lines.push(bold("  Not mediated by the shim"), "");
  for (const entry of UNSUPPORTED_PATHS) {
    lines.push(`    ${entry.path}`);
    lines.push(`      ${dim(entry.reason)}`);
  }
  lines.push("");
  lines.push(
    dim(
      "  PATH shims are not an operating-system sandbox. CI receipt verification is the backstop.",
    ),
  );
  lines.push("");

  deps.stderr(lines.join("\n"));
  return EXIT.allow;
}
