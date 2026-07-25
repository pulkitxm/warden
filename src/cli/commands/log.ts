import { join } from "node:path";
import { parseArgs } from "node:util";
import { EXIT } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";

export function runWardenLog(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  try {
    const { values } = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, tail: { type: "string" } },
    });
    const tail = values.tail === undefined ? undefined : Number(values.tail);
    if (tail !== undefined && (!Number.isInteger(tail) || tail < 0))
      throw new Error("--tail must be a non-negative integer");
    const logPath = join(deps.home, ".warden", "log.jsonl");
    if (!deps.exists(logPath)) {
      deps.stderr("warden: no recorded verdicts yet\n");
      return EXIT.allow;
    }
    const raw = deps.readFile(logPath);
    const lines = raw.split("\n").filter(Boolean);
    const selected = tail === undefined ? lines : tail === 0 ? [] : lines.slice(-tail);
    if (!selected.length) {
      deps.stderr("warden: no recorded verdicts yet\n");
      return EXIT.allow;
    }
    for (const line of selected) {
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        if (values.json) {
          deps.stdout(`${line}\n`);
          continue;
        }
        const timestamp = String(item.timestamp ?? item.time ?? "unknown-time");
        const level = String(item.verdict ?? "unknown").toUpperCase();
        const packageName = String(item.package ?? "unknown-package");
        const version = item.version ? `@${String(item.version)}` : "";
        const risk = item.risk_score === undefined ? "" : ` risk=${String(item.risk_score)}`;
        const categories =
          Array.isArray(item.categories) && item.categories.length
            ? ` ${item.categories.join(",").replaceAll("_", "-")}`
            : "";
        deps.stderr(`${timestamp} ${level} ${packageName}${version}${risk}${categories}\n`);
      } catch {
        deps.stderr("warden: skipped malformed log entry\n");
      }
    }
    return EXIT.allow;
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_LOG_ERROR",
      (error as Error).message,
      "run warden log --help",
    );
  }
}
