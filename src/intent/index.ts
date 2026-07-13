import { join } from "node:path";
import { parseArgs } from "node:util";
import { type WardenDeps, wardenFailure } from "../cli/main.ts";
import { EXIT, INTENT_JSON_SCHEMA } from "../schema.ts";
import { extractClaims } from "./extract.ts";
import type { IntentLedger } from "./types.ts";

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

function renderLedger(ledger: IntentLedger): string {
  const rows = ledger.claims.map((claim) => `  ${claim.id}  [${claim.kind}]  ${claim.claim}`);
  return `intent claims (${ledger.claims.length}):\n${rows.join("\n")}\n`;
}

async function runIntentExtract(flags: IntentFlags, deps: WardenDeps): Promise<number> {
  const prompt = flags.prompt?.trim();
  if (!prompt) {
    return wardenFailure(
      deps,
      flags.json,
      "usage",
      "WARDEN_INTENT_ERROR",
      "no prompt provided",
      'pass --prompt "<text>"',
    );
  }
  const ledger = await extractClaims(prompt);
  const root = deps.cwd();
  deps.mkdir(join(root, ".warden"));
  deps.writeFile(join(root, ".warden", "claims.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  deps.stderr(renderLedger(ledger));
  if (flags.json) deps.stdout(`${JSON.stringify(ledger)}\n`);
  return EXIT.allow;
}

const INTENT_VERBS: Record<
  string,
  (flags: IntentFlags, deps: WardenDeps) => number | Promise<number>
> = {
  schema: runIntentSchema,
  extract: runIntentExtract,
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
      "check git, --prompt, and your llm api key (GROQ_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY)",
    );
  }
}
