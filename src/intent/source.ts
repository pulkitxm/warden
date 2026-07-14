import * as acorn from "acorn";

export interface ParseableSource {
  code: string;
  exact: boolean;
}

const TS_LOADERS: Record<string, "ts" | "tsx"> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

export function toParseable(code: string, path: string): ParseableSource {
  const ext = path.match(/\.[^./\\]+$/)?.[0] ?? "";
  const loader = TS_LOADERS[ext];
  if (!loader) return { code, exact: true };
  try {
    const out = new Bun.Transpiler({ loader }).transformSync(code);
    return { code: out, exact: out.split("\n").length === code.split("\n").length };
  } catch {
    return { code, exact: false };
  }
}

export function parseProgram(code: string): acorn.Node | null {
  try {
    return acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowReturnOutsideFunction: true,
    });
  } catch {
    try {
      return acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "script",
        locations: true,
        allowReturnOutsideFunction: true,
      });
    } catch {
      return null;
    }
  }
}
