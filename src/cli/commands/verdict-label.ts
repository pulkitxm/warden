import { c, dim } from "../../shared/ansi.ts";

export const LABEL: Record<string, string> = {
  allow: c("32", "ALLOW"),
  warn: c("33", "WARN"),
  block: c("31", "BLOCK"),
  unknown: dim("UNKNOWN"),
};
