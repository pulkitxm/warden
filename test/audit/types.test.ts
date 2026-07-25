import { expect, test } from "bun:test";
import { type AuditFinding, worstLevel } from "../../src/audit/types.ts";

const finding = (level: AuditFinding["level"]): AuditFinding => ({
  rule: "r",
  level,
  target: "t",
  file: "f",
  evidence: "e",
  fix: "x",
});

test("worstLevel reports the most severe finding present", () => {
  expect(worstLevel([])).toBe("allow");
  expect(worstLevel([finding("allow")])).toBe("allow");
  expect(worstLevel([finding("allow"), finding("warn")])).toBe("warn");
  expect(worstLevel([finding("warn"), finding("block")])).toBe("block");
  expect(worstLevel([finding("block"), finding("warn")])).toBe("block");
});
