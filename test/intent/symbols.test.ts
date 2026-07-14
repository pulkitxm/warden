import { expect, test } from "bun:test";
import { API_SIGNATURES, curatedSurface } from "../../src/intent/api-db.ts";
import { parseProgram } from "../../src/intent/source.ts";
import {
  type Binding,
  bindingsFromAst,
  bindingsFromText,
  collectExports,
  extractSurface,
  findHallucinations,
  memberAccesses,
  propagateInstances,
  type SurfaceIo,
} from "../../src/intent/symbols.ts";
import type { ApiSurface } from "../../src/intent/types.ts";

function mapIo(files: Record<string, string>): SurfaceIo {
  return {
    readFile: (path) => {
      const value = files[path];
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
  };
}

const NO_IO = mapIo({});

test("curatedSurface resolves direct, node-prefixed, and unknown packages", () => {
  expect(curatedSurface("axios")).toBe(API_SIGNATURES.axios!);
  expect(curatedSurface("fs")).toBe(API_SIGNATURES["node:fs"]!);
  expect(curatedSurface("node:fs")).toBe(API_SIGNATURES["node:fs"]!);
  expect(curatedSurface("node:zzz")).toBeUndefined();
  expect(curatedSurface("left-pad")).toBeUndefined();
});

test("bindingsFromAst collects every import and require shape", () => {
  const program = parseProgram(
    [
      'import axios from "axios";',
      'import * as fs from "node:fs";',
      'import { object as zObject, ZodError } from "zod";',
      'import local from "./local.ts";',
      'const express = require("express");',
      'const { throttle: slow, debounce } = require("lodash");',
      "const dyn = require(name);",
      "const plain = create();",
    ].join("\n"),
  );
  expect(bindingsFromAst(program)).toEqual({
    axios: { pkg: "axios", kind: "default" },
    fs: { pkg: "node:fs", kind: "namespace" },
    zObject: { pkg: "zod", kind: "named", imported: "object" },
    ZodError: { pkg: "zod", kind: "named", imported: "ZodError" },
    express: { pkg: "express", kind: "namespace" },
    slow: { pkg: "lodash", kind: "named", imported: "throttle" },
    debounce: { pkg: "lodash", kind: "named", imported: "debounce" },
  });
});

test("bindingsFromText handles single-line imports and requires", () => {
  const bindings = bindingsFromText(
    [
      'import axios from "axios";',
      'import * as fs from "node:fs";',
      'import def, { a as b, c } from "pkg";',
      'import { x } from "./rel";',
      'const express = require("express");',
      'const { throttle: slow, , } = require("lodash");',
      'const nope = require("./local");',
    ].join("\n"),
  );
  expect(bindings).toEqual({
    axios: { pkg: "axios", kind: "default" },
    fs: { pkg: "node:fs", kind: "namespace" },
    def: { pkg: "pkg", kind: "default" },
    b: { pkg: "pkg", kind: "named", imported: "a" },
    c: { pkg: "pkg", kind: "named", imported: "c" },
    express: { pkg: "express", kind: "namespace" },
    slow: { pkg: "lodash", kind: "named", imported: "throttle" },
  });
});

const surfaceOf = (pkg: string): ApiSurface | null => curatedSurface(pkg) ?? null;

test("propagateInstances tracks curated factory calls one hop", () => {
  const bindings: Record<string, Binding> = {
    axios: { pkg: "axios", kind: "default" },
    express: { pkg: "express", kind: "namespace" },
    Router: { pkg: "express", kind: "named", imported: "Router" },
    mystery: { pkg: "not-curated", kind: "default" },
  };
  const code = [
    "const client = axios.create({});",
    "const app = express();",
    "const router = new Router();",
    "const other = axios.unknownFactory();",
    "const loose = mystery.create();",
    "const orphan = unbound.create();",
    "const chained = client.get();",
    "no factories here",
  ].join("\n");
  const out = propagateInstances(code, bindings, surfaceOf);
  expect(out.client).toEqual({ pkg: "axios", kind: "default", instanceOf: "instance" });
  expect(out.app).toEqual({ pkg: "express", kind: "namespace", instanceOf: "app" });
  expect(out.router).toEqual({ pkg: "express", kind: "named", instanceOf: "router" });
  expect(out.other).toBeUndefined();
  expect(out.loose).toBeUndefined();
  expect(out.orphan).toBeUndefined();
  expect(out.chained).toBeUndefined();
});

test("memberAccesses anchors lines, skips assignments and comment noise", () => {
  const accesses = memberAccesses(
    [
      "client.throttle(1);",
      "a.b = 1;",
      "a.b == 1;",
      "x.y(z.w);",
      "// ghost.member()",
      "real.thing(); /* other.member() */",
    ].join("\n"),
  );
  expect(accesses).toEqual([
    { name: "client", member: "throttle", line: 1 },
    { name: "a", member: "b", line: 3 },
    { name: "x", member: "y", line: 4 },
    { name: "z", member: "w", line: 4 },
    { name: "real", member: "thing", line: 6 },
  ]);
});

function exportsOf(code: string) {
  return collectExports(parseProgram(code));
}

test("collectExports reads esm export shapes", () => {
  const esm = exportsOf(
    [
      "export function alpha() {}",
      "export class Beta {}",
      "export const gamma = 1, delta = 2;",
      "const epsilon = 3;",
      "export { epsilon };",
    ].join("\n"),
  );
  expect([...esm.root].sort()).toEqual(["Beta", "alpha", "delta", "epsilon", "gamma"]);
  expect(esm.closed).toBe(true);

  expect(exportsOf('export * from "./other.js";').closed).toBe(false);

  const dflt = exportsOf("export default { a, b: 2, 'c': 3 };");
  expect([...dflt.root].sort()).toEqual(["a", "b", "c", "default"]);

  const viaVar = exportsOf("const api = { run: 1 };\nexport default api;");
  expect(viaVar.root.has("run")).toBe(true);

  const fnDefault = exportsOf("export default function main() {}");
  expect([...fnDefault.root]).toEqual(["default"]);

  const spread = exportsOf("export default { ...rest };");
  expect(spread.closed).toBe(false);

  const computed = exportsOf("export default { [key]: 1 };");
  expect(computed.closed).toBe(false);
});

test("collectExports reads cjs export shapes", () => {
  const object = exportsOf("module.exports = { alpha: 1, beta: 2 };");
  expect([...object.root].sort()).toEqual(["alpha", "beta"]);
  expect(object.closed).toBe(true);

  const hop = exportsOf('module.exports = require("./lib/impl.js");');
  expect(hop.hop).toBe("./lib/impl.js");

  const viaVar = exportsOf("const api = { run: 1 };\nmodule.exports = api;");
  expect(viaVar.root.has("run")).toBe(true);

  const dynamic = exportsOf("module.exports = buildApi();");
  expect(dynamic.closed).toBe(false);

  const members = exportsOf("module.exports.alpha = 1;\nexports.beta = 2;\nother.gamma = 3;");
  expect([...members.root].sort()).toEqual(["alpha", "beta"]);

  expect(exportsOf("Object.assign(module.exports, extra);").closed).toBe(false);
  expect(exportsOf('Object.defineProperty(exports, "x", {});').closed).toBe(false);
  expect(exportsOf("Object.assign(somethingElse, extra);").closed).toBe(true);
});

const PKG = "/repo/node_modules/fake-lib";

function fakePackage(pkgJson: string, files: Record<string, string> = {}): SurfaceIo {
  return mapIo({ [`${PKG}/package.json`]: pkgJson, ...files });
}

test("extractSurface resolves entries through exports, main, and index fallbacks", () => {
  const code = "module.exports = { alpha: 1, beta: 2 };";
  const viaExportsString = fakePackage('{"exports":"./entry.js"}', { [`${PKG}/entry.js`]: code });
  expect(extractSurface("fake-lib", "/repo", viaExportsString)).toEqual({
    root: ["alpha", "beta"],
    instances: {},
    closed: true,
  });

  const viaDotConditions = fakePackage('{"exports":{".":{"require":"./entry.js"}}}', {
    [`${PKG}/entry.js`]: code,
  });
  expect(extractSurface("fake-lib", "/repo", viaDotConditions)?.root).toEqual(["alpha", "beta"]);

  const viaNested = fakePackage('{"exports":{".":{"default":{"import":"./entry.js"}}}}', {
    [`${PKG}/entry.js`]: code,
  });
  expect(extractSurface("fake-lib", "/repo", viaNested)?.root).toEqual(["alpha", "beta"]);

  const viaMain = fakePackage('{"main":"lib/entry"}', { [`${PKG}/lib/entry.js`]: code });
  expect(extractSurface("fake-lib", "/repo", viaMain)?.root).toEqual(["alpha", "beta"]);

  const viaIndex = fakePackage("{}", { [`${PKG}/index.js`]: code });
  expect(extractSurface("fake-lib", "/repo", viaIndex)?.root).toEqual(["alpha", "beta"]);

  const viaDir = fakePackage('{"main":"lib"}', { [`${PKG}/lib/index.js`]: code });
  expect(extractSurface("fake-lib", "/repo", viaDir)?.root).toEqual(["alpha", "beta"]);
});

test("extractSurface follows exactly one require hop", () => {
  const hop = fakePackage('{"main":"entry.js"}', {
    [`${PKG}/entry.js`]: 'module.exports = require("./lib/impl");',
    [`${PKG}/lib/impl.js`]: "module.exports = { alpha: 1 };",
  });
  expect(extractSurface("fake-lib", "/repo", hop)?.root).toEqual(["alpha"]);

  const doubleHop = fakePackage('{"main":"entry.js"}', {
    [`${PKG}/entry.js`]: 'module.exports = require("./a");',
    [`${PKG}/a.js`]: 'module.exports = require("./b");',
    [`${PKG}/b.js`]: "module.exports = { alpha: 1 };",
  });
  expect(extractSurface("fake-lib", "/repo", doubleHop)).toBeNull();

  const brokenHop = fakePackage('{"main":"entry.js"}', {
    [`${PKG}/entry.js`]: 'module.exports = require("./missing");',
  });
  expect(extractSurface("fake-lib", "/repo", brokenHop)).toBeNull();
});

test("extractSurface refuses everything it cannot positively resolve", () => {
  expect(extractSurface("node:fs", "/repo", NO_IO)).toBeNull();
  expect(extractSurface("fake-lib", "/repo", NO_IO)).toBeNull();
  expect(extractSurface("fake-lib", "/repo", fakePackage("not json"))).toBeNull();
  expect(extractSurface("fake-lib", "/repo", fakePackage('{"main":"addon.node"}'))).toBeNull();
  expect(extractSurface("fake-lib", "/repo", fakePackage('{"main":"data.json"}'))).toBeNull();
  expect(extractSurface("fake-lib", "/repo", fakePackage('{"main":"entry.js"}'))).toBeNull();
  const unparseable = fakePackage('{"main":"entry.js"}', { [`${PKG}/entry.js`]: "let let = ;" });
  expect(extractSurface("fake-lib", "/repo", unparseable)).toBeNull();
  const empty = fakePackage('{"main":"entry.js"}', { [`${PKG}/entry.js`]: "const a = 1;" });
  expect(extractSurface("fake-lib", "/repo", empty)).toBeNull();
});

function scan(code: string, added: number[], io: SurfaceIo = NO_IO) {
  const files = new Map([["api-client.ts", { code, addedLines: new Set(added) }]]);
  return findHallucinations(files, "/repo", io);
}

const DEMO = [
  'import axios from "axios";',
  "const client = axios.create({ baseURL: process.env.API_URL });",
  "async function fetchPage(url: string): Promise<unknown> {",
  "  client.throttle({ rate: 5 });",
  "  const res = await client.get(url);",
  "  return res.data;",
  "}",
  "export { fetchPage };",
].join("\n");

test("findHallucinations catches the demo axios instance hallucination with proof", () => {
  const findings = scan(DEMO, [4, 5]);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    symbol: "axios.instance.throttle",
    package: "axios",
    file: "api-client.ts",
    line: 4,
    source: "curated",
  });
  expect(findings[0]!.proof).toContain("axios instance has no member 'throttle'");
  expect(findings[0]!.proof).toContain("Known: get, post, put, delete");
  expect(findings[0]!.proof).toContain("…");
  expect(findings[0]!.proof).toContain("curated signature db");
});

test("findHallucinations only judges added lines", () => {
  expect(scan(DEMO, [5, 6])).toHaveLength(0);
});

test("findHallucinations stays silent on unknowns, prototypes, and real members", () => {
  const code = [
    'import mystery from "mystery-pkg";',
    'import axios from "axios";',
    "mystery.whatever();",
    "axios.create({});",
    "axios.then(done);",
    "freeVar.member();",
  ].join("\n");
  expect(scan(code, [3, 4, 5, 6])).toHaveLength(0);
});

test("findHallucinations survives prototype-named identifiers without crashing", () => {
  const code = [
    'import axios from "axios";',
    "const proto = hasOwnProperty.call(obj, key);",
    "const tag = toString.call(value);",
    "constructor.build();",
    "valueOf.compute();",
    "axios.create({});",
  ].join("\n");
  expect(scan(code, [2, 3, 4, 5, 6])).toHaveLength(0);
});

test("findHallucinations checks named-import namespaces and skips unknown named imports", () => {
  const code = [
    'import { z } from "zod";',
    'import { AxiosError } from "axios";',
    "z.objct({});",
    "z.object({});",
    "AxiosError.captureStackTrace();",
  ].join("\n");
  const findings = scan(code, [3, 4, 5]);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.symbol).toBe("zod.root.objct");
  expect(findings[0]!.proof).toContain("zod.z has no member 'objct'");
});

test("findHallucinations resolves uncurated packages from node_modules and dedupes", () => {
  const io = fakePackage('{"main":"entry.js"}', {
    [`${PKG}/entry.js`]: "module.exports = { alpha: 1, beta: 2 };",
  });
  const code = [
    'const lib = require("fake-lib");',
    "lib.gamma();",
    "lib.gamma();",
    "lib.alpha();",
  ].join("\n");
  const files = new Map([
    ["a.js", { code, addedLines: new Set([2, 3, 4]) }],
    ["b.js", { code: 'const lib = require("fake-lib");\nlib.gamma();', addedLines: new Set([2]) }],
  ]);
  const findings = findHallucinations(files, "/repo", io);
  expect(findings).toHaveLength(3);
  expect(findings[0]!.source).toBe("node_modules");
  expect(findings[0]!.proof).toContain("fake-lib has no member 'gamma'");
  expect(findings[0]!.proof).toContain("extracted from node_modules");
  expect(findings[0]!.proof).not.toContain("…");
});

test("findHallucinations never flags open surfaces", () => {
  const io = fakePackage('{"main":"entry.js"}', {
    [`${PKG}/entry.js`]: "module.exports = { alpha: 1 };\nObject.assign(module.exports, extra);",
  });
  const code = ['const lib = require("fake-lib");', "lib.gamma();"].join("\n");
  expect(scan(code, [2], io)).toHaveLength(0);
});

test("findHallucinations falls back to text bindings when nothing parses", () => {
  const code = [
    'import axios from "axios";',
    "const client = axios.create({});",
    "let let = ;",
    "client.throttle(1);",
  ].join("\n");
  const findings = scan(code, [4]);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.symbol).toBe("axios.instance.throttle");
});
