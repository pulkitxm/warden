import { expect, test } from "bun:test";
import { auditAllowlistEntry, auditScripts, readAllowlist } from "../../src/audit/scripts.ts";
import type { AuditFs } from "../../src/audit/types.ts";

function fsWith(files: Record<string, string>, globbed: string[] = []): AuditFs {
  return {
    exists: (path) => path in files,
    readFile: (path) => {
      const key = Object.keys(files)
        .sort((a, b) => b.length - a.length)
        .find((name) => path.endsWith(name));
      if (!key) throw new Error(`ENOENT ${path}`);
      return files[key] as string;
    },
    glob: () => globbed,
  };
}

const rulesOf = (
  pkg: string,
  version: string | undefined,
  manifest: Parameters<typeof readAllowlist>[0],
) =>
  auditAllowlistEntry(pkg, version, "postinstall", readAllowlist(manifest), "x").map((f) => f.rule);

test("readAllowlist recognises each manager's allowlist in precedence order", () => {
  expect(readAllowlist({ allowScripts: { esbuild: "0.21.4" } }).manager).toBe("npm");
  expect(readAllowlist({ trustedDependencies: ["esbuild"] }).manager).toBe("bun");
  expect(readAllowlist({ pnpm: { onlyBuiltDependencies: ["esbuild"] } }).manager).toBe("pnpm");
  expect(readAllowlist({ dependenciesMeta: { esbuild: { built: true } } }).manager).toBe("yarn");
  expect(readAllowlist({}).manager).toBe("none");
});

test("readAllowlist keeps npm ranges verbatim and widens boolean allowlists", () => {
  expect(readAllowlist({ allowScripts: { a: "1.2.3" } }).ranges.get("a")).toBe("1.2.3");
  expect(readAllowlist({ trustedDependencies: ["a"] }).ranges.get("a")).toBe("*");
  expect(readAllowlist({ pnpm: { onlyBuiltDependencies: ["a"] } }).ranges.get("a")).toBe("*");
  expect(readAllowlist({ dependenciesMeta: { a: { built: true } } }).ranges.get("a")).toBe("*");
});

test("readAllowlist ignores empty and unbuilt entries", () => {
  expect(readAllowlist({ allowScripts: {} }).manager).toBe("none");
  expect(readAllowlist({ trustedDependencies: [] }).manager).toBe("none");
  expect(readAllowlist({ pnpm: {} }).manager).toBe("none");
  expect(readAllowlist({ dependenciesMeta: { a: { built: false } } }).manager).toBe("none");
  expect(readAllowlist({ dependenciesMeta: { a: {} } }).manager).toBe("none");
});

test("a package outside the allowlist is flagged because npm v12 skips it silently", () => {
  const findings = auditAllowlistEntry("native", "1.0.0", "install", readAllowlist({}), "m");
  expect(findings[0]?.rule).toBe("script_not_allowlisted");
  expect(findings[0]?.level).toBe("warn");
  expect(findings[0]?.evidence).toContain("still exits 0");
  expect(findings[0]?.evidence).toContain("install-script allowlist");
  expect(findings[0]?.target).toBe("native@1.0.0");
});

test("the finding names whichever manager's allowlist is in force", () => {
  const cases: Array<[Parameters<typeof readAllowlist>[0], string]> = [
    [{ allowScripts: { other: "1.0.0" } }, "npm"],
    [{ trustedDependencies: ["other"] }, "bun"],
    [{ pnpm: { onlyBuiltDependencies: ["other"] } }, "pnpm"],
    [{ dependenciesMeta: { other: { built: true } } }, "yarn"],
  ];
  for (const [manifest, label] of cases) {
    const findings = auditAllowlistEntry(
      "missing",
      "1.0.0",
      "install",
      readAllowlist(manifest),
      "m",
    );
    expect(findings[0]?.evidence).toContain(`${label} allowlist`);
  }
});

test("an exactly pinned allowlist entry is clean", () => {
  expect(rulesOf("esbuild", "0.21.4", { allowScripts: { esbuild: "0.21.4" } })).toEqual([]);
  expect(rulesOf("esbuild", "0.21.4", { allowScripts: { esbuild: ">=0.21.0 <0.22.0" } })).toEqual(
    [],
  );
});

test("a range that auto-approves future releases is flagged as overbroad", () => {
  for (const range of ["*", "x", "latest", "0.x", "1.x.x", "0.21.x"]) {
    expect(`${range}:${rulesOf("esbuild", "0.21.4", { allowScripts: { esbuild: range } })}`).toBe(
      `${range}:script_allowlist_overbroad`,
    );
  }
});

test("boolean allowlists are inherently overbroad", () => {
  expect(rulesOf("esbuild", "0.21.4", { trustedDependencies: ["esbuild"] })).toEqual([
    "script_allowlist_overbroad",
  ]);
  expect(rulesOf("esbuild", "0.21.4", { dependenciesMeta: { esbuild: { built: true } } })).toEqual([
    "script_allowlist_overbroad",
  ]);
});

test("an allowlist the installed version has outgrown is stale, not silently trusted", () => {
  const findings = auditAllowlistEntry(
    "quiet",
    "2.0.0",
    "install",
    readAllowlist({ allowScripts: { quiet: "1.0.0" } }),
    "m",
  );
  expect(findings[0]?.rule).toBe("script_allowlist_stale");
  expect(findings[0]?.evidence).toContain('"1.0.0"');
});

test("an entry with no resolvable version is not judged stale", () => {
  expect(rulesOf("quiet", undefined, { allowScripts: { quiet: "1.0.0" } })).toEqual([]);
});

test("auditScripts flags dependency hooks against the allowlist but never the root manifest", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({
          name: "root",
          scripts: { postinstall: "node ./scripts/setup.js" },
          allowScripts: { reviewed: "1.0.0" },
        }),
        "node_modules/reviewed/package.json": JSON.stringify({
          name: "reviewed",
          version: "1.0.0",
          scripts: { postinstall: "node build.js" },
        }),
        "node_modules/native/package.json": JSON.stringify({
          name: "native",
          version: "2.0.0",
          scripts: { install: "node-gyp rebuild" },
        }),
      },
      ["node_modules/reviewed/package.json", "node_modules/native/package.json"],
    ),
  );

  const allowlistRules = report.findings
    .filter((f) => f.rule.startsWith("script_not_allowlisted") || f.rule.includes("allowlist"))
    .map((f) => `${f.target}:${f.rule}`);
  expect(allowlistRules).toEqual(["native@2.0.0:script_not_allowlisted"]);
  expect(report.findings.some((f) => f.target.startsWith("root"))).toBe(true);
  expect(report.findings.some((f) => f.target === "root" && f.rule.includes("allowlist"))).toBe(
    false,
  );
});

test("each dependency is judged against the allowlist once, not per hook", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({ name: "root" }),
        "node_modules/multi/package.json": JSON.stringify({
          name: "multi",
          version: "1.0.0",
          scripts: { preinstall: "echo a", install: "echo b", postinstall: "echo c" },
        }),
      },
      ["node_modules/multi/package.json"],
    ),
  );
  expect(report.findings.filter((f) => f.rule === "script_not_allowlisted")).toHaveLength(1);
});

test("an unreadable root manifest degrades to no allowlist rather than throwing", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": "{not json",
        "node_modules/native/package.json": JSON.stringify({
          name: "native",
          version: "1.0.0",
          scripts: { install: "node-gyp rebuild" },
        }),
      },
      ["node_modules/native/package.json"],
    ),
  );
  expect(report.findings.map((f) => f.rule)).toContain("script_not_allowlisted");
});
