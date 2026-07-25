import {
  AUDIT_JSON_SCHEMA,
  DOCTOR_JSON_SCHEMA,
  EXIT,
  FINDINGS_JSON_SCHEMA,
  INTENT_JSON_SCHEMA,
  SCHEMA_VERSION,
  VERDICT_JSON_SCHEMA,
} from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";

const SCHEMAS: Record<string, unknown> = {
  check: VERDICT_JSON_SCHEMA,
  ci: FINDINGS_JSON_SCHEMA,
  audit: AUDIT_JSON_SCHEMA,
  doctor: DOCTOR_JSON_SCHEMA,
  intent: INTENT_JSON_SCHEMA,
};

const SCHEMA_VERBS = Object.keys(SCHEMAS);

export function runWardenSchema(argv: string[], deps: WardenDeps): number {
  const verb = argv[0] ?? "check";
  if (verb === "list") {
    deps.stdout(`${JSON.stringify({ schema_version: SCHEMA_VERSION, schemas: SCHEMA_VERBS })}\n`);
    return EXIT.allow;
  }
  const schema = SCHEMAS[verb];
  if (schema) {
    deps.stdout(`${JSON.stringify(schema, null, 2)}\n`);
    return EXIT.allow;
  }
  return wardenFailure(
    deps,
    true,
    "usage",
    "WARDEN_UNKNOWN_SCHEMA",
    `no schema for verb "${verb}"`,
    `known schemas: ${SCHEMA_VERBS.join(", ")}`,
  );
}
