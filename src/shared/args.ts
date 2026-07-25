import { parseArgs } from "node:util";

export function parseArgsSafe<T extends NonNullable<Parameters<typeof parseArgs>[0]>>(
  config: T,
): ReturnType<typeof parseArgs<T>> | null {
  try {
    return parseArgs(config);
  } catch {
    return null;
  }
}
