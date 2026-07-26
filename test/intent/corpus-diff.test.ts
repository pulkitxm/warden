import { expect, test } from "bun:test";
import {
  changeGroups,
  corpusDiffText,
  diffOps,
  unifiedDiff,
} from "../../src/intent/corpus/diff.ts";
import { addedLineSets, parseUnifiedDiff } from "../../src/intent/diff.ts";

test("an unchanged pair produces only context ops", () => {
  const ops = diffOps(["a", "b"], ["a", "b"]);
  expect(ops.map((op) => op.kind).join("")).toBe("  ");
});

test("a replacement produces a removal followed by an addition", () => {
  const ops = diffOps(["a", "b", "c"], ["a", "B", "c"]);
  expect(ops.map((op) => `${op.kind}${op.text}`)).toEqual([" a", "-b", "+B", " c"]);
});

test("a pure append produces additions after the shared prefix", () => {
  const ops = diffOps(["a"], ["a", "b", "c"]);
  expect(ops.map((op) => op.kind).join("")).toBe(" ++");
});

test("a pure truncation produces removals after the shared prefix", () => {
  const ops = diffOps(["a", "b", "c"], ["a"]);
  expect(ops.map((op) => op.kind).join("")).toBe(" --");
});

test("changes six unchanged lines apart merge into one group, as git merges them", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const after = ["a", "b", "c", "D", "e", "f", "g", "h", "i", "j", "k"];
  expect(changeGroups(diffOps(before, after)).length).toBe(1);
});

test("changes eight unchanged lines apart split into two groups, as git splits them", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
  const after = ["a", "b", "c", "D", "e", "f", "g", "h", "i", "j", "k", "L"];
  expect(changeGroups(diffOps(before, after)).length).toBe(2);
});

test("an unchanged file has no change groups", () => {
  expect(changeGroups(diffOps(["a"], ["a"]))).toEqual([]);
});

test("a split diff carries the line numbers git would emit", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n");
  const after = ["a", "b", "c", "D", "e", "f", "g", "h", "i", "j", "k", "L"].join("\n");
  const text = unifiedDiff({ path: "g.txt", before, after });
  expect(text).toContain("@@ -1,7 +1,7 @@");
  expect(text).toContain("@@ -9,4 +9,4 @@");
});

test("a new file is emitted in the form the parser recognises as added", () => {
  const text = unifiedDiff({ path: "n.js", after: "const a = 1;\nconst b = 2;\n" });
  expect(text).toContain("new file mode 100644");
  expect(text).toContain("--- /dev/null");
  expect(text).toContain("@@ -0,0 +1,2 @@");
  const parsed = parseUnifiedDiff(text);
  expect(parsed[0]?.added).toBe(true);
});

test("a deleted file is emitted in the form the parser recognises as deleted", () => {
  const text = unifiedDiff({ path: "gone.js", before: "const a = 1;\n" });
  expect(text).toContain("deleted file mode 100644");
  expect(text).toContain("+++ /dev/null");
  expect(parseUnifiedDiff(text)[0]?.deleted).toBe(true);
});

test("a pure rename is emitted without hunks and records where it came from", () => {
  const text = unifiedDiff({
    path: "src/http.js",
    before: "const a = 1;\n",
    after: "const a = 1;\n",
    renamedFrom: "http.js",
  });
  expect(text).toContain("rename from http.js");
  expect(text).toContain("rename to src/http.js");
  expect(text).not.toContain("@@");
  expect(parseUnifiedDiff(text)[0]?.renamedFrom).toBe("http.js");
});

test("a rename that also edits content still emits hunks against the old path", () => {
  const text = unifiedDiff({
    path: "src/http.js",
    before: "const a = 1;\n",
    after: "const a = 2;\n",
    renamedFrom: "http.js",
  });
  expect(text).toContain("--- a/http.js");
  expect(text).toContain("@@");
});

test("the synthesized added lines survive a round trip through the real parser", () => {
  const text = corpusDiffText([
    {
      path: "one.js",
      before: "const a = 1;\nconst b = 2;\n",
      after: "const a = 1;\nconst b = 3;\n",
    },
    { path: "two.js", after: "const c = 4;\n" },
  ]);
  const added = addedLineSets(parseUnifiedDiff(text));
  expect([...(added.get("one.js") ?? [])]).toEqual([2]);
  expect([...(added.get("two.js") ?? [])]).toEqual([1]);
});

test("a trailing newline does not become a phantom line", () => {
  const withNewline = unifiedDiff({ path: "a.js", after: "const a = 1;\n" });
  const withoutNewline = unifiedDiff({ path: "a.js", after: "const a = 1;" });
  expect(withNewline).toBe(withoutNewline);
});
