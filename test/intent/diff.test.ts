import { expect, test } from "bun:test";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import {
  addedLineSets,
  classifyHunks,
  declsFromText,
  indexDeclarations,
  parseUnifiedDiff,
  symbolScanFiles,
} from "../../src/intent/diff.ts";

function diffFor(file: string, hunk: string[], markers: string[] = []): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    ...markers,
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunk,
    "",
  ].join("\n");
}

test("parseUnifiedDiff reads files, renames, modes, binaries, and hunks", () => {
  const text = [
    "junk preamble ignored",
    "diff --git a/old-name.ts b/new-name.ts",
    "similarity index 90%",
    "rename from old-name.ts",
    "rename to new-name.ts",
    "--- a/old-name.ts",
    "+++ b/new-name.ts",
    "@@ -1,2 +1,3 @@",
    " context",
    "+added",
    " more",
    "diff --git a/fresh.ts b/fresh.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/fresh.ts",
    "@@ -0,0 +1 @@",
    "+const a = 1;",
    "\\ No newline at end of file",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-const b = 2;",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    "",
  ].join("\n");
  const diffs = parseUnifiedDiff(text);
  expect(diffs).toHaveLength(4);
  expect(diffs[0]).toMatchObject({ file: "new-name.ts", renamedFrom: "old-name.ts" });
  expect(diffs[0]!.hunks[0]).toEqual({
    file: "new-name.ts",
    oldStart: 1,
    newStart: 1,
    lines: [" context", "+added", " more"],
  });
  expect(diffs[1]).toMatchObject({ file: "fresh.ts", added: true });
  expect(diffs[1]!.hunks[0]!.lines).toContain("\\ No newline at end of file");
  expect(diffs[2]).toMatchObject({ file: "gone.ts", deleted: true });
  expect(diffs[3]).toMatchObject({ file: "logo.png", binary: true, hunks: [] });
});

test("addedLineSets computes post-image line numbers across hunks", () => {
  const diffs = parseUnifiedDiff(
    diffFor("x.ts", ["@@ -1,3 +1,4 @@", " one", "-two", "+two!", "+three", " four"]),
  );
  expect(addedLineSets(diffs).get("x.ts")).toEqual(new Set([2, 3]));
});

test("indexDeclarations maps functions, classes, methods, and variables", () => {
  const decls = indexDeclarations(
    [
      "export function alpha() {",
      "  return 1;",
      "}",
      "class Beta {",
      "  run() {",
      "    return 2;",
      "  }",
      "}",
      "const gamma = () => 3;",
      "let delta = 4;",
      "const { skipped } = source;",
      "export default function omega() {}",
    ].join("\n"),
  );
  expect(decls).toEqual([
    { name: "alpha", kind: "function", lineStart: 1, lineEnd: 3 },
    { name: "Beta", kind: "class", lineStart: 4, lineEnd: 8 },
    { name: "Beta.run", kind: "method", lineStart: 5, lineEnd: 7 },
    { name: "gamma", kind: "function", lineStart: 9, lineEnd: 9 },
    { name: "delta", kind: "variable", lineStart: 10, lineEnd: 10 },
    { name: "omega", kind: "function", lineStart: 12, lineEnd: 12 },
  ]);
  expect(indexDeclarations("let let = ;")).toEqual([]);
});

test("declsFromText survives an unclosed brace", () => {
  expect(declsFromText("function broken() {\n  const a = 1;")).toEqual([
    { name: "broken", kind: "function", lineStart: 1, lineEnd: 2 },
    { name: "a", kind: "variable", lineStart: 2, lineEnd: 2 },
  ]);
});

test("classifyHunks uses acorn declarations for plain javascript", () => {
  const image = ["function go(a) {", "  return a;", "}"].join("\n");
  const hunks = classify(
    "plain.js",
    ["@@ -1,1 +1,3 @@", "+function go(a) {", "+  return a;", "+}"],
    image,
  );
  expect(hunks[0]!.category).toBe("new_function");
  expect(hunks[0]!.symbols).toEqual(["go"]);
});

test("declsFromText anchors declarations by line with next-decl ranges", () => {
  const decls = declsFromText(
    ["function go(a) {", "  return a;", "}", "class Thing {", "}", "const fn = () => 1;"].join(
      "\n",
    ),
  );
  expect(decls).toEqual([
    { name: "go", kind: "function", lineStart: 1, lineEnd: 3 },
    { name: "Thing", kind: "class", lineStart: 4, lineEnd: 5 },
    { name: "fn", kind: "variable", lineStart: 6, lineEnd: 6 },
  ]);
});

function classify(file: string, hunk: string[], postImage = "", markers: string[] = []) {
  const diffs = parseUnifiedDiff(diffFor(file, hunk, markers));
  return classifyHunks(diffs, (path) => {
    if (path.endsWith(file) && postImage) return postImage;
    throw new Error("ENOENT");
  });
}

test("classifyHunks labels deletions, docs, formatting, and non-js files", () => {
  expect(classify("x.ts", ["@@ -1,2 +1,1 @@", " keep", "-gone"])[0]!.category).toBe("deletion");
  expect(
    classify("gone.ts", ["@@ -1 +0,0 @@", "-const b = 2;"], "", ["deleted file mode 100644"])[0]!
      .category,
  ).toBe("deletion");
  expect(classify("test/x.test.ts", ["@@ -1 +1 @@", "-a", "+b"])[0]!.category).toBe("test_or_doc");
  expect(classify("README.md", ["@@ -1 +1 @@", "-a", "+b"])[0]!.category).toBe("test_or_doc");
  expect(
    classify("x.ts", ["@@ -1,2 +1,2 @@", "-const a=1;", "+const a = 1;", " keep"])[0]!.category,
  ).toBe("formatting_only");
  expect(classify("style.css", ["@@ -1 +1,2 @@", " body {}", "+p {}"])[0]!.category).toBe("other");
});

test("classifyHunks labels import changes", () => {
  expect(
    classify("x.ts", ["@@ -1 +1,2 @@", " const a = 1;", '+import axios from "axios";'])[0]!
      .category,
  ).toBe("import_added");
  expect(
    classify("x.ts", [
      "@@ -1,2 +1,2 @@",
      '-const b = require("lodash");',
      "+const b = 1;",
      " k",
    ])[0]!.category,
  ).toBe("import_removed");
});

const NEW_FN_IMAGE = [
  "const client = createClient();",
  "function fetchPage(url) {",
  "  return client.get(url);",
  "}",
  "export { fetchPage };",
].join("\n");

test("classifyHunks spots fully-added functions and changed signatures", () => {
  const newFn = classify(
    "api.ts",
    [
      "@@ -1,2 +1,5 @@",
      " const client = createClient();",
      "+function fetchPage(url) {",
      "+  return client.get(url);",
      "+}",
      " export { fetchPage };",
    ],
    NEW_FN_IMAGE,
  );
  expect(newFn[0]!.category).toBe("new_function");
  expect(newFn[0]!.symbols).toContain("fetchPage");
  expect(newFn[0]!.summary).toContain("new_function");

  const signature = classify(
    "api.ts",
    [
      "@@ -2,2 +2,2 @@",
      "-function fetchPage(url, retries) {",
      "+function fetchPage(url) {",
      "  return client.get(url);",
    ],
    NEW_FN_IMAGE,
  );
  expect(signature[0]!.category).toBe("signature_change");
});

test("classifyHunks labels conditionals, assignments, and other edits", () => {
  const image = ["function go(x) {", "  let y = x;", "  return y;", "}"].join("\n");
  expect(
    classify(
      "x.ts",
      ["@@ -2,2 +2,3 @@", "   let y = x;", "+  if (x > 2) y = 0;", "   return y;"],
      image,
    )[0]!.category,
  ).toBe("conditional_changed");
  expect(
    classify(
      "x.ts",
      ["@@ -2,2 +2,3 @@", "   let y = x;", "+  y = x * 2;", "   return y;"],
      image,
    )[0]!.category,
  ).toBe("assignment_changed");
  expect(
    classify(
      "x.ts",
      ["@@ -2,2 +2,3 @@", "   let y = x;", "+  console.log(y);", "   return y;"],
      image,
    )[0]!.category,
  ).toBe("other");
});

test("classifyHunks skips binary files and survives unreadable post-images", () => {
  const binary = parseUnifiedDiff(
    ["diff --git a/x.png b/x.png", "Binary files a/x.png and b/x.png differ", ""].join("\n"),
  );
  expect(
    classifyHunks(binary, () => {
      throw new Error("ENOENT");
    }),
  ).toEqual([]);
  const unreadable = classify("x.ts", ["@@ -1 +1,2 @@", " a", "+console.log(1);"]);
  expect(unreadable[0]!.category).toBe("other");
});

const DEMO_DIFF = diffFor("api-client.ts", [
  "@@ -1,3 +1,7 @@",
  ' import axios from "axios";',
  " const client = axios.create({});",
  "-export {};",
  "+function fetchPage(url) {",
  "+  client.throttle(1);",
  "+  return client.get(url);",
  "+}",
  "+export { fetchPage };",
]);

const DEMO_IMAGE = [
  'import axios from "axios";',
  "const client = axios.create({});",
  "function fetchPage(url) {",
  "  client.throttle(1);",
  "  return client.get(url);",
  "}",
  "export { fetchPage };",
].join("\n");

test("symbolScanFiles pairs post-images with added lines for js files only", () => {
  const text = [
    DEMO_DIFF,
    diffFor("notes.md", ["@@ -1 +1 @@", "-a", "+b"]),
    diffFor("gone.ts", ["@@ -1 +0,0 @@", "-x"], ["deleted file mode 100644"]),
    diffFor("missing.ts", ["@@ -1 +1,2 @@", " a", "+b"]),
  ].join("");
  const diffs = parseUnifiedDiff(text);
  const files = symbolScanFiles(diffs, (path) => {
    if (path === "api-client.ts") return DEMO_IMAGE;
    throw new Error("ENOENT");
  });
  expect([...files.keys()]).toEqual(["api-client.ts"]);
  expect(files.get("api-client.ts")!.addedLines).toEqual(new Set([3, 4, 5, 6, 7]));
});

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cwd: () => "/repo",
    readFile: (path) => {
      if (path === "/repo/api-client.ts") return DEMO_IMAGE;
      throw new Error("ENOENT");
    },
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "merge-base") return { exitCode: 0, stdout: "abc123def\n", stderr: "" };
      if (args[0] === "diff") return { exitCode: 0, stdout: DEMO_DIFF, stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    },
    ...over,
  };
  return { deps, out, err };
}

test("warden intent diff renders and emits classified hunks", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "diff", "--json", "--base", "main"], state.deps)).toBe(0);
  const hunks = JSON.parse(state.out.join("")) as Array<{ id: string; category: string }>;
  expect(hunks).toHaveLength(1);
  expect(hunks[0]!.category).toBe("new_function");
  expect(state.err.join("")).toContain("classified hunks (1):");
});

test("warden intent symbols blocks on hallucinated apis with proof", async () => {
  const state = makeDeps();
  expect(await runWarden(["intent", "symbols", "--json"], state.deps)).toBe(20);
  const findings = JSON.parse(state.out.join("")) as Array<{ symbol: string }>;
  expect(findings[0]!.symbol).toBe("axios.instance.throttle");
  expect(state.err.join("")).toContain("axios instance has no member 'throttle'");
});

test("warden intent symbols allows clean diffs", async () => {
  const cleanDiff = diffFor("api-client.ts", [
    "@@ -5,1 +5,1 @@",
    "-  return client.get(url);",
    "+  return client.get(String(url));",
  ]);
  const state = makeDeps({
    git: (args) => {
      if (args[0] === "diff") return { exitCode: 0, stdout: cleanDiff, stderr: "" };
      return { exitCode: 0, stdout: "abc123def\n", stderr: "" };
    },
  });
  expect(await runWarden(["intent", "symbols"], state.deps)).toBe(0);
  expect(state.err.join("")).toContain("no hallucinated apis found");
});

test("warden intent diff fails when no merge base exists", async () => {
  const state = makeDeps({
    git: (args) => {
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "true\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "fatal: no merge base" };
    },
  });
  expect(await runWarden(["intent", "diff"], state.deps)).toBe(30);
  expect(state.err.join("")).toContain("neither origin/main nor main is available");
});

test("warden intent diff reports empty diffs", async () => {
  const state = makeDeps({
    git: (args) => {
      if (args[0] === "diff") return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    },
  });
  expect(await runWarden(["intent", "diff"], state.deps)).toBe(0);
  expect(state.err.join("")).toContain("no hunks in the diff");
});
