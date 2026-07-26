import { expect, test } from "bun:test";
import {
  collectAddedImports,
  declaredPackages,
  packageNameOf,
  scanDependencies,
} from "../../src/intent/deps.ts";
import type { IntentPipelineDeps } from "../../src/intent/types.ts";

const ROOT = "/repo";

function fakeDeps(files: Record<string, string>): IntentPipelineDeps {
  return {
    git: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    readFile: (path) => {
      const value = files[path.replace(/\\/g, "/")];
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
  };
}

function scanned(code: string, file = "src/a.js") {
  const lines = code.split("\n").length;
  return new Map([
    [file, { code, addedLines: new Set(Array.from({ length: lines }, (_, i) => i + 1)) }],
  ]);
}

test("a package name is taken from the specifier, and non-packages are ignored", () => {
  expect(packageNameOf("lodash")).toBe("lodash");
  expect(packageNameOf("lodash/fp/map")).toBe("lodash");
  expect(packageNameOf("@scope/pkg")).toBe("@scope/pkg");
  expect(packageNameOf("@scope/pkg/sub")).toBe("@scope/pkg");
  expect(packageNameOf("")).toBeNull();
  expect(packageNameOf("./local.js")).toBeNull();
  expect(packageNameOf("/abs/path.js")).toBeNull();
  expect(packageNameOf("#internal")).toBeNull();
  expect(packageNameOf("https://cdn.example.com/x.js")).toBeNull();
  expect(packageNameOf("@scope")).toBeNull();
  expect(packageNameOf("@scope/")).toBeNull();
});

test("only imports on added lines are collected, once each", () => {
  const files = new Map([
    [
      "src/a.js",
      {
        code: [
          'import a from "alpha";',
          'import b from "beta";',
          'const c = require("gamma");',
        ].join("\n"),
        addedLines: new Set([1, 3]),
      },
    ],
  ]);
  expect(collectAddedImports(files)).toEqual([
    { spec: "alpha", file: "src/a.js", line: 1 },
    { spec: "gamma", file: "src/a.js", line: 3 },
  ]);
});

test("a line importing twice reports both specifiers", () => {
  const found = collectAddedImports(
    scanned('export { a } from "alpha"; export { b } from "beta";'),
  );
  expect(found.map((entry) => entry.spec)).toEqual(["alpha", "beta"]);
});

test("declared packages cover the manifest name and every dependency group", () => {
  const declared = declaredPackages(
    fakeDeps({
      "/repo/package.json": JSON.stringify({
        name: "self",
        dependencies: { a: "1" },
        devDependencies: { b: "1" },
        peerDependencies: { c: "1" },
        optionalDependencies: { d: "1" },
        bundledDependencies: ["ignored"],
      }),
    }),
    ROOT,
  );
  expect([...(declared ?? [])].sort()).toEqual(["a", "b", "c", "d", "self"]);
});

test("a missing or unparseable manifest reads as unknown rather than as empty", () => {
  expect(declaredPackages(fakeDeps({}), ROOT)).toBeNull();
  expect(declaredPackages(fakeDeps({ "/repo/package.json": "{oops" }), ROOT)).toBeNull();
});

test("a manifest whose dependency group is not an object is skipped, not crashed on", () => {
  const declared = declaredPackages(
    fakeDeps({ "/repo/package.json": '{"dependencies":"nonsense","devDependencies":null}' }),
    ROOT,
  );
  expect([...(declared ?? [])]).toEqual([]);
});

test("without a manifest the scan says it did not check rather than reporting clean", async () => {
  const scan = await scanDependencies(scanned('import a from "alpha";'), ROOT, fakeDeps({}));
  expect(scan.findings).toEqual([]);
  expect(scan.notes[0]).toContain("no readable package.json");
});

test("a declared package, a builtin, and a relative import are all quiet", async () => {
  const scan = await scanDependencies(
    scanned(
      [
        'import axios from "axios";',
        'import { join } from "node:path";',
        'import fs from "fs";',
        'import local from "./local.js";',
      ].join("\n"),
    ),
    ROOT,
    fakeDeps({ "/repo/package.json": '{"dependencies":{"axios":"^1.0.0"}}' }),
  );
  expect(scan.findings).toEqual([]);
});

test("an installed but undeclared import warns and says it is installed", async () => {
  const scan = await scanDependencies(
    scanned('import { chunk } from "lodash";'),
    ROOT,
    fakeDeps({
      "/repo/package.json": "{}",
      "/repo/node_modules/lodash/package.json": '{"name":"lodash"}',
    }),
  );
  expect(scan.findings).toHaveLength(1);
  expect(scan.findings[0]).toMatchObject({
    package: "lodash",
    rule: "undeclared_import",
    level: "warn",
    line: 1,
  });
  expect(scan.findings[0]!.proof).toContain("installed, but no dependency group");
  expect(scan.notes).toEqual([]);
});

test("the same undeclared package imported twice is reported once", async () => {
  const files = new Map([
    ["a.js", { code: 'import a from "lodash";', addedLines: new Set([1]) }],
    ["b.js", { code: 'import b from "lodash/fp";', addedLines: new Set([1]) }],
  ]);
  const scan = await scanDependencies(files, ROOT, fakeDeps({ "/repo/package.json": "{}" }));
  expect(scan.findings).toHaveLength(1);
});

test("a name on the curated slopsquat list blocks without needing the network", async () => {
  const scan = await scanDependencies(
    scanned('import codeshift from "react-codeshift";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
  );
  expect(scan.findings[0]).toMatchObject({
    package: "react-codeshift",
    rule: "known_hallucinated_name",
    level: "block",
  });
  expect(scan.findings[0]!.proof).toContain("names language models invent");
});

test("an unresolved import says the registry was not consulted when no lookup is available", async () => {
  const scan = await scanDependencies(
    scanned('import ghost from "definitely-not-real-pkg";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
  );
  expect(scan.findings[0]).toMatchObject({ rule: "undeclared_import", level: "warn" });
  expect(scan.findings[0]!.proof).toContain("neither declared in package.json nor present");
  expect(scan.notes[0]).toContain("registry existence not checked");
  expect(scan.notes[0]).toContain("definitely-not-real-pkg");
});

test("a name the registry does not know is upgraded to a blocking finding", async () => {
  const scan = await scanDependencies(
    scanned('import ghost from "fetch-retry-helper-pro";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
    () => Promise.resolve(false),
  );
  expect(scan.findings[0]).toMatchObject({ rule: "unpublished_package", level: "block" });
  expect(scan.findings[0]!.proof).toContain("does not exist on the registry");
  expect(scan.findings[0]!.fix).toContain("slopsquat");
});

test("a real but uninstalled package stays a warning, not a block", async () => {
  const scan = await scanDependencies(
    scanned('import ky from "ky";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
    () => Promise.resolve(true),
  );
  expect(scan.findings[0]).toMatchObject({ rule: "undeclared_import", level: "warn" });
  expect(scan.notes).toEqual([]);
});

test("a lookup that cannot answer is recorded as unchecked, not as clean", async () => {
  const unknown = await scanDependencies(
    scanned('import ghost from "maybe-real";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
    () => Promise.resolve(null),
  );
  expect(unknown.findings[0]!.rule).toBe("undeclared_import");
  expect(unknown.notes[0]).toContain("the lookup did not answer");

  const thrown = await scanDependencies(
    scanned('import ghost from "maybe-real";'),
    ROOT,
    fakeDeps({ "/repo/package.json": "{}" }),
    () => Promise.reject(new Error("offline")),
  );
  expect(thrown.notes[0]).toContain("the lookup did not answer");
});

test("an installed undeclared package never reaches the registry lookup", async () => {
  const asked: string[] = [];
  const scan = await scanDependencies(
    scanned('import { chunk } from "lodash";'),
    ROOT,
    fakeDeps({
      "/repo/package.json": "{}",
      "/repo/node_modules/lodash/package.json": '{"name":"lodash"}',
    }),
    (name) => {
      asked.push(name);
      return Promise.resolve(false);
    },
  );
  expect(asked).toEqual([]);
  expect(scan.findings[0]!.level).toBe("warn");
});

test("importing the package's own name is not an undeclared import", async () => {
  const scan = await scanDependencies(
    scanned('import self from "my-lib";'),
    ROOT,
    fakeDeps({ "/repo/package.json": '{"name":"my-lib"}' }),
  );
  expect(scan.findings).toEqual([]);
});
