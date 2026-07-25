import { EXIT } from "../schema.ts";
import type { RunDeps, WardenDeps } from "./deps.ts";

export function wardenFailure(
  deps: WardenDeps,
  json: boolean,
  kind: "usage" | "analysis" | "config",
  code: string,
  reason: string,
  hint: string,
): number {
  if (json) deps.stdout(`${JSON.stringify({ error: { kind, code, reason, hint } })}\n`);
  else deps.stderr(`warden: ${reason}\nhint: ${hint}\n`);
  return EXIT.error;
}

export async function guarded(
  tool: string,
  deps: RunDeps,
  fn: () => Promise<number>,
): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    deps.stderr(`${tool}: analysis error: ${(e as Error).message}\n`);
    return EXIT.error;
  }
}
