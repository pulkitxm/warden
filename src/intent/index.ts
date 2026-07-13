import { parseArgs } from "node:util";
import { type WardenDeps, wardenFailure } from "../cli/main.ts";
import { EXIT, INTENT_JSON_SCHEMA } from "../schema.ts";

export interface IntentFlags {
  verb: string;
  prompt?: string;
  base?: string;
  json: boolean;
}

export function parseIntentArgs(argv: string[]): IntentFlags {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      base: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  return {
    verb: positionals[0] ?? "check",
    prompt: values.prompt,
    base: values.base,
    json: Boolean(values.json),
  };
}

function runIntentSchema(_flags: IntentFlags, deps: WardenDeps): number {
  deps.stdout(`${JSON.stringify(INTENT_JSON_SCHEMA, null, 2)}\n`);
  return EXIT.allow;
}

const INTENT_VERBS: Record<
  string,
  (flags: IntentFlags, deps: WardenDeps) => number | Promise<number>
> = {
  schema: runIntentSchema,
};

export async function runWardenIntent(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  try {
    const flags = parseIntentArgs(argv);
    const handler = INTENT_VERBS[flags.verb];
    if (!handler) {
      return wardenFailure(
        deps,
        wantsJson,
        "usage",
        "WARDEN_INTENT_ERROR",
        `unknown intent verb "${flags.verb}"`,
        "run warden intent --help",
      );
    }
    return await handler(flags, deps);
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_INTENT_ERROR",
      (error as Error).message,
      "run warden intent --help",
    );
  }
}
