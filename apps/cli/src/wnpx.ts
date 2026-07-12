#!/usr/bin/env bun
/**
 * `wnpx <pkg[@version]> [--json] [--allow-risky]`
 *
 * Agent-safe mode: with --json, writes EXACTLY ONE JSON object (the Verdict) to
 * stdout and nothing else — human output goes to stderr. A coding agent runs
 * this before executing an npx command and gates on `verdict`.
 *
 * Exit: 0 allow · 10 warn · 20 block · 30 analysis error.
 */

import { parseArgs } from "node:util";
import { checkPackage } from "./engine.ts";
import { renderVerdict, dim } from "./ui.ts";
import { exitCodeFor, VERDICT_JSON_SCHEMA, EXIT } from "@warden/schema";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { json: { type: "boolean" }, "allow-risky": { type: "boolean" }, schema: { type: "boolean" } },
  allowPositionals: true,
});

if (values.schema) {
  process.stdout.write(JSON.stringify(VERDICT_JSON_SCHEMA, null, 2) + "\n");
  process.exit(0);
}

const spec = positionals[0];
if (!spec) {
  process.stderr.write("usage: wnpx <pkg[@version]> [--json] [--allow-risky]\n");
  process.exit(2);
}

try {
  const verdict = await checkPackage(spec);

  if (values.json) {
    process.stdout.write(JSON.stringify(verdict) + "\n");
    process.exit(exitCodeFor(verdict.verdict));
  }

  process.stderr.write(renderVerdict(verdict));
  if (verdict.verdict === "block" && !values["allow-risky"]) {
    process.stderr.write(dim("refusing to run a blocked package; re-run with --allow-risky to override\n"));
    process.exit(EXIT.block);
  }
  process.stderr.write(dim(`(would execute: npx ${spec})\n`));
  process.exit(exitCodeFor(verdict.verdict === "block" ? "warn" : verdict.verdict));
} catch (e) {
  process.stderr.write(`wnpx: analysis error: ${(e as Error).message}\n`);
  process.exit(EXIT.error); // fail open, loudly
}
