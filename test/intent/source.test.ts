import { expect, test } from "bun:test";
import { parseProgram, toParseable } from "../../src/intent/source.ts";

test("toParseable passes javascript through untouched", () => {
  const code = "const a = 1;\n";
  expect(toParseable(code, "x.js")).toEqual({ code, exact: true });
  expect(toParseable(code, "no-extension")).toEqual({ code, exact: true });
});

test("toParseable strips typescript types via the bun transpiler", () => {
  const code = 'interface C { n: number }\nconst a: C = { n: 1 };\nexport { a };\n';
  const result = toParseable(code, "x.ts");
  expect(result.code).not.toContain("interface");
  expect(result.code).toContain("const a");
  expect(typeof result.exact).toBe("boolean");
});

test("toParseable falls back to the original source when the transpiler throws", () => {
  const code = "let let = ;";
  expect(toParseable(code, "x.ts")).toEqual({ code, exact: false });
});

test("parseProgram parses modules, sloppy scripts, and rejects garbage", () => {
  expect(parseProgram('import a from "b";')).not.toBeNull();
  expect(parseProgram("with (window) { a(); }")).not.toBeNull();
  expect(parseProgram("let let = ;")).toBeNull();
});
