import { expect, test } from "bun:test";
import {
  auditAllowlistEntry,
  auditScripts,
  readAllowlist,
  readPnpmAllowlist,
} from "../../src/audit/scripts.ts";
import type { AuditFs } from "../../src/audit/types.ts";

function fsWith(files: Record<string, string>, globbed: string[] = []): AuditFs {
  return {
    exists: (path) => Object.keys(files).some((name) => path.endsWith(name)),
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

test("readAllowlist recognises each manager's native policy shape", () => {
  expect(readAllowlist({ allowScripts: { "esbuild@0.21.4": true } }).manager).toBe("npm");
  expect(readAllowlist({ trustedDependencies: ["esbuild"] }).manager).toBe("bun");
  expect(readAllowlist({ pnpm: { onlyBuiltDependencies: ["esbuild"] } }).manager).toBe("pnpm");
  expect(readAllowlist({ dependenciesMeta: { esbuild: { built: true } } }).manager).toBe("yarn");
  expect(readAllowlist({}).manager).toBe("none");
});

test("npm policy keys carry selectors and boolean decisions", () => {
  const policy = readAllowlist({
    allowScripts: {
      "esbuild@0.21.4": true,
      telemetry: false,
    },
  });
  expect(policy.entries).toEqual([
    { name: "esbuild", range: "0.21.4", allowed: true },
    { name: "telemetry", allowed: false },
  ]);
});

test("scoped package selectors split after the package name", () => {
  const policy = readAllowlist({ allowScripts: { "@scope/native@1.2.3": true } });
  expect(policy.entries).toEqual([{ name: "@scope/native", range: "1.2.3", allowed: true }]);
});

test("empty policies remain associated with their package manager", () => {
  expect(readAllowlist({ allowScripts: {} })).toMatchObject({ manager: "npm", configured: true });
  expect(readAllowlist({ trustedDependencies: [] })).toMatchObject({
    manager: "bun",
    configured: true,
  });
  expect(readAllowlist({ dependenciesMeta: {} })).toMatchObject({
    manager: "yarn",
    configured: true,
  });
});

test("pnpm 11 allowBuilds is read from pnpm-workspace.yaml", () => {
  const policy = readPnpmAllowlist(`
allowBuilds:
  esbuild: true
  core-js: false
  "nx@21.6.4 || 21.6.5": true
`);
  expect(policy).toMatchObject({ manager: "pnpm", configured: true });
  expect(policy.entries).toEqual([
    { name: "esbuild", allowed: true },
    { name: "core-js", allowed: false },
    { name: "nx", range: "21.6.4 || 21.6.5", allowed: true },
  ]);
});

test("a package outside the active policy is reported without assuming its installer outcome", () => {
  const findings = auditAllowlistEntry(
    "native",
    "1.0.0",
    "install",
    readAllowlist({ allowScripts: {} }),
    "m",
  );
  expect(findings[0]?.rule).toBe("script_not_allowlisted");
  expect(findings[0]?.level).toBe("warn");
  expect(findings[0]?.evidence).toContain("npm install-script approval");
  expect(findings[0]?.target).toBe("native@1.0.0");
});

test("the remediation follows the active package manager", () => {
  const cases: Array<[Parameters<typeof readAllowlist>[0], string]> = [
    [{ allowScripts: {} }, "npm approve-scripts"],
    [{ trustedDependencies: [] }, "bun pm trust"],
    [{ pnpm: { onlyBuiltDependencies: [] } }, "pnpm approve-builds"],
    [{ dependenciesMeta: {} }, "dependenciesMeta"],
  ];
  for (const [manifest, command] of cases) {
    const findings = auditAllowlistEntry(
      "missing",
      "1.0.0",
      "install",
      readAllowlist(manifest),
      "m",
    );
    expect(findings[0]?.fix).toContain(command);
  }
});

test("exact npm pins and exact version disjunctions are clean", () => {
  expect(rulesOf("esbuild", "0.21.4", { allowScripts: { "esbuild@0.21.4": true } })).toEqual([]);
  expect(
    rulesOf("esbuild", "0.21.4", {
      allowScripts: { "esbuild@0.21.3 || 0.21.4": true },
    }),
  ).toEqual([]);
});

test("name-only approvals and ranges are overbroad", () => {
  for (const selector of [
    "esbuild",
    "esbuild@*",
    "esbuild@latest",
    "esbuild@0.x",
    "esbuild@^0.21.0",
  ]) {
    expect(rulesOf("esbuild", "0.21.4", { allowScripts: { [selector]: true } })).toEqual([
      "script_allowlist_overbroad",
    ]);
  }
});

test("a broad approval remains visible beside an exact pin", () => {
  expect(
    rulesOf("esbuild", "0.21.4", {
      allowScripts: { "esbuild@0.21.4": true, esbuild: true },
    }),
  ).toEqual(["script_allowlist_overbroad"]);
});

test("boolean-only manager approvals are reported as unpinned", () => {
  expect(rulesOf("esbuild", "0.21.4", { trustedDependencies: ["esbuild"] })).toEqual([
    "script_allowlist_overbroad",
  ]);
  expect(rulesOf("esbuild", "0.21.4", { dependenciesMeta: { esbuild: { built: true } } })).toEqual([
    "script_allowlist_overbroad",
  ]);
});

test("an exact approval for another installed version is stale", () => {
  const findings = auditAllowlistEntry(
    "quiet",
    "2.0.0",
    "install",
    readAllowlist({ allowScripts: { "quiet@1.0.0": true } }),
    "m",
  );
  expect(findings[0]?.rule).toBe("script_allowlist_stale");
  expect(findings[0]?.evidence).toContain("1.0.0");
});

test("an explicit denial is intentional and produces no posture warning", () => {
  expect(rulesOf("telemetry", "2.0.0", { allowScripts: { telemetry: false } })).toEqual([]);
  expect(
    rulesOf("telemetry", "2.0.0", {
      dependenciesMeta: { telemetry: { built: false } },
    }),
  ).toEqual([]);
});

test("auditScripts checks dependency hooks against npm policy but never the root manifest", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({
          name: "root",
          packageManager: "npm@12.0.1",
          scripts: { postinstall: "node ./scripts/setup.js" },
          allowScripts: { "reviewed@1.0.0": true },
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
    .filter((finding) => finding.rule.includes("allowlist"))
    .map((finding) => `${finding.target}:${finding.rule}`);
  expect(allowlistRules).toEqual(["native@2.0.0:script_not_allowlisted"]);
  expect(report.findings.some((finding) => finding.target.startsWith("root"))).toBe(true);
  expect(
    report.findings.some(
      (finding) => finding.target === "root" && finding.rule.includes("allowlist"),
    ),
  ).toBe(false);
});

test("pnpm projects use allowBuilds from pnpm-workspace.yaml", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({ name: "root", packageManager: "pnpm@11.13.0" }),
        "pnpm-workspace.yaml": "allowBuilds:\n  esbuild@0.21.4: true\n",
        "node_modules/esbuild/package.json": JSON.stringify({
          name: "esbuild",
          version: "0.21.4",
          scripts: { postinstall: "node install.js" },
        }),
      },
      ["node_modules/esbuild/package.json"],
    ),
  );
  expect(report.findings.filter((finding) => finding.rule.includes("allowlist"))).toEqual([]);
});

test("each installed version is judged once even when a package has several hooks", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({ name: "root", allowScripts: {} }),
        "node_modules/multi/package.json": JSON.stringify({
          name: "multi",
          version: "1.0.0",
          scripts: { preinstall: "echo a", install: "echo b", postinstall: "echo c" },
        }),
        "node_modules/other/node_modules/multi/package.json": JSON.stringify({
          name: "multi",
          version: "2.0.0",
          scripts: { install: "echo d" },
        }),
      },
      ["node_modules/multi/package.json", "node_modules/other/node_modules/multi/package.json"],
    ),
  );
  expect(
    report.findings.filter((finding) => finding.rule === "script_not_allowlisted"),
  ).toHaveLength(2);
});

test("prepublish is audited as a script but not treated as an install approval hook", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({ name: "root", allowScripts: {} }),
        "node_modules/publisher/package.json": JSON.stringify({
          name: "publisher",
          version: "1.0.0",
          scripts: { prepublish: "echo publish" },
        }),
      },
      ["node_modules/publisher/package.json"],
    ),
  );
  expect(report.findings.map((finding) => finding.rule)).toEqual(["script_lifecycle_present"]);
});

test("an unreadable root manifest degrades without throwing", () => {
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
  expect(report.findings.map((finding) => finding.rule)).toContain("script_not_allowlisted");
});
