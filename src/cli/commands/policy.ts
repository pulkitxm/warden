import { join } from "node:path";
import { compilePolicy, resolvePolicy, type WardenPolicy } from "../../policy/compile.ts";
import { EXIT } from "../../schema.ts";
import { bold, dim } from "../../shared/ansi.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { detectManager, type PackageManager } from "../../shared/manager.ts";
import { isQuiet } from "../../shared/output.ts";

const MANAGERS: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

export function readProjectPolicy(deps: WardenDeps, root: string): WardenPolicy | undefined {
  const path = join(root, "warden.config.json");
  if (!deps.exists(path)) return undefined;
  try {
    return (JSON.parse(deps.readFile(path)) as { policy?: WardenPolicy }).policy;
  } catch {
    return undefined;
  }
}

export function runWardenPolicy(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  const root = deps.cwd();
  const fs = { readFile: deps.readFile, exists: deps.exists, which: deps.which };

  const index = argv.indexOf("--manager");
  const requested = index === -1 ? undefined : argv[index + 1];
  if (requested && !MANAGERS.includes(requested as PackageManager)) {
    return wardenFailure(
      deps,
      wantsJson,
      "usage",
      "WARDEN_POLICY_MANAGER",
      `unknown package manager "${requested}"`,
      `choose one of ${MANAGERS.join(", ")}`,
    );
  }

  const manager = (requested as PackageManager) ?? detectManager(fs, root).manager;
  const policy = resolvePolicy(readProjectPolicy(deps, root));
  const compiled = compilePolicy(manager, policy);

  if (wantsJson) {
    deps.stdout(`${JSON.stringify({ schema_version: 1, policy, compiled })}\n`);
    return EXIT.allow;
  }
  if (isQuiet()) return EXIT.allow;

  const lines: string[] = ["", bold(`Policy compiled for ${manager}`), ""];
  lines.push(bold("  Intent"));
  for (const [key, value] of Object.entries(policy)) lines.push(`    ${key.padEnd(24)} ${value}`);
  lines.push("");

  lines.push(bold("  Native settings"));
  if (compiled.settings.length) {
    for (const setting of compiled.settings) {
      lines.push(`    ${setting.file.padEnd(22)} ${setting.key} = ${setting.value}`);
      lines.push(`      ${dim(setting.note)}`);
    }
  } else lines.push(dim("    this manager exposes no native setting for the current policy"));
  lines.push("");

  if (compiled.unsupported.length) {
    lines.push(bold("  Not natively supported"));
    for (const entry of compiled.unsupported) {
      lines.push(`    ${entry.intent}`);
      lines.push(`      ${dim(entry.reason)}`);
    }
    lines.push("");
  }

  lines.push(bold("  Enforced by warden regardless"));
  for (const entry of compiled.enforcedByWarden) lines.push(`    ${entry}`);
  lines.push("");
  lines.push(dim("  warden policy --json prints the same result for a setup script"));
  lines.push("");

  deps.stderr(lines.join("\n"));
  return EXIT.allow;
}
