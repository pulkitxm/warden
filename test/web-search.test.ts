import { expect, test } from "bun:test";
import { excerptOf, prepare, type SearchRecord, search, tokenize } from "../web/src/lib/search.ts";

const record = (over: Partial<SearchRecord> & Pick<SearchRecord, "id" | "title" | "path">) => ({
  kind: "section" as const,
  page: "Doctor",
  section: "Using Warden",
  text: "",
  keywords: "",
  ...over,
});

const CORPUS: SearchRecord[] = [
  record({
    id: "doctor",
    kind: "page",
    title: "Doctor",
    path: "/docs/doctor",
    text: "The repair loop that audits, gates its own fixes, and verifies them in isolation.",
    keywords: "doctor Using Warden",
  }),
  record({
    id: "doctor#exit-codes",
    title: "Exit codes",
    path: "/docs/doctor#exit-codes",
    text: "0 clean or fully fixed, 10 unresolved issues remain, 30 error.",
  }),
  record({
    id: "check-surfaces#lockfile",
    title: "Lockfile",
    page: "Check surfaces",
    path: "/docs/check-surfaces#lockfile",
    text: "lockfile_missing_integrity is blocking and lockfile_weak_integrity is a warning.",
  }),
  record({
    id: "cli/ci",
    kind: "command",
    title: "warden ci",
    page: "CLI reference",
    section: "CLI",
    path: "/docs/cli/ci",
    text: "Gate a pull request on the dependency and surface changes it introduces.",
    keywords: "ci --reporter --base",
  }),
];

const ENTRIES = prepare(CORPUS);
const paths = (query: string) => search(ENTRIES, query).map((hit) => hit.path);

test("tokenizing keeps the punctuation that appears in rule and flag names", () => {
  expect(tokenize("lockfile_missing_integrity")).toEqual(["lockfile_missing_integrity"]);
  expect(tokenize("warden ci --reporter")).toEqual(["warden", "ci", "--reporter"]);
  expect(tokenize("  ")).toEqual([]);
});

test("an empty query matches nothing rather than everything", () => {
  expect(search(ENTRIES, "")).toEqual([]);
});

test("a heading match resolves to the anchor on the page, not the page itself", () => {
  expect(paths("exit codes")[0]).toBe("/docs/doctor#exit-codes");
});

test("a title match outranks a body mention of the same word", () => {
  const results = paths("doctor");
  expect(results[0]).toBe("/docs/doctor");
});

test("underscored rule names are findable in section bodies", () => {
  expect(paths("lockfile_missing_integrity")).toEqual(["/docs/check-surfaces#lockfile"]);
});

test("every query token has to match somewhere", () => {
  expect(paths("exit codes zzzzz")).toEqual([]);
});

test("flags reach the command page they belong to", () => {
  expect(paths("--reporter")[0]).toBe("/docs/cli/ci");
});

test("a typo still finds the page through subsequence matching", () => {
  expect(paths("doctr")[0]).toBe("/docs/doctor");
});

test("the excerpt is drawn from around the first match", () => {
  const long = `${"padding word ".repeat(30)}the needle sits here${" trailing word".repeat(30)}`;
  const excerpt = excerptOf(long, ["needle"]);
  expect(excerpt).toContain("needle");
  expect(excerpt.startsWith("…")).toBe(true);
  expect(excerpt.length).toBeLessThan(220);
});

test("a short body is returned whole, without ellipses", () => {
  expect(excerptOf("short body", ["short"])).toBe("short body");
});
