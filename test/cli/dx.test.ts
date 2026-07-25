import { expect, test } from "bun:test";
import { defaultWardenDeps, nearestVerb, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { renderVerdict } from "../../src/cli/ui.ts";
import { ANALYZER_VERSION, SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";
import { setColor } from "../../src/shared/ansi.ts";

const ESC = String.fromCharCode(27);
const strip = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function makeDeps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    check: () => Promise.reject(new Error("unused")),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, out, err };
}

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  schema_version: SCHEMA_VERSION,
  package: "axios",
  version: "1.14.1",
  integrity: "sha512-x",
  verdict: "block",
  risk_score: 90,
  categories: [],
  summary: "blocked",
  evidence: [],
  analyzer_version: ANALYZER_VERSION,
  source: "heuristics",
  ...over,
});

const typos: Array<[string, string]> = [
  ["docter", "doctor"],
  ["doctr", "doctor"],
  ["chekc", "check"],
  ["intnet", "intent"],
  ["shcema", "schema"],
  ["detct", "detect"],
  ["verison", "version"],
];

for (const [typo, expected] of typos) {
  test(`"${typo}" suggests "${expected}"`, () => {
    expect(nearestVerb(typo)).toBe(expected);
  });
}

test("a verb that resembles nothing gets no suggestion", () => {
  expect(nearestVerb("xyzzyplughblah")).toBeNull();
});

test("suggestions never point at a hidden verb", () => {
  expect(nearestVerb("select-managerz")).not.toBe("select-managers");
});

test("an unknown verb suggests the closest match on stderr", async () => {
  const { deps, err } = makeDeps();
  expect(await runWarden(["docter"], deps)).toBe(30);
  expect(err.join("")).toContain('did you mean "warden doctor"?');
});

test("an unknown verb suggestion also reaches the JSON error envelope", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["chekc", "--json"], deps)).toBe(30);
  const error = JSON.parse(out.join("")).error;
  expect(error.code).toBe("WARDEN_UNKNOWN_VERB");
  expect(error.hint).toContain("warden check");
});

test("an unrecognisable verb falls back to the help hint", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["xyzzyplughblah", "--json"], deps)).toBe(30);
  expect(JSON.parse(out.join("")).error.hint).toBe("run warden --help");
});

test("-h is accepted alongside --help, globally and per verb", async () => {
  const root = makeDeps();
  expect(await runWarden(["-h"], root.deps)).toBe(0);
  expect(root.err.join("")).toContain("usage: warden <verb> [flags]");

  const verb = makeDeps();
  expect(await runWarden(["doctor", "-h"], verb.deps)).toBe(0);
  expect(verb.err.join("")).toContain("usage: warden doctor");
});

test("--no-color strips ANSI from rendered output and is not passed to the verb", async () => {
  setColor(true);
  expect(renderVerdict(verdict())).toContain(ESC);

  const { deps, err } = makeDeps();
  expect(await runWarden(["--no-color", "doctor", "-h"], deps)).toBe(0);
  const text = err.join("");
  expect(text).not.toContain(ESC);
  expect(text).toContain("usage: warden doctor");

  setColor(false);
  expect(renderVerdict(verdict())).not.toContain(ESC);
});

test("a provenance downgrade is called out in human output, not just the JSON", () => {
  setColor(false);
  const text = strip(renderVerdict(verdict({ categories: ["provenance_downgrade"] })));
  expect(text).toContain("provenance downgrade");
  expect(text).toContain("trusted publisher flow");
});

test("known malware and slopsquat also get a headline line", () => {
  setColor(false);
  expect(strip(renderVerdict(verdict({ categories: ["known_malware"] })))).toContain(
    "known malware",
  );
  expect(strip(renderVerdict(verdict({ categories: ["slopsquat"] })))).toContain("slopsquat");
});

test("an ordinary verdict gains no headline line", () => {
  setColor(false);
  const text = strip(renderVerdict(verdict({ categories: ["metadata_anomaly"] })));
  expect(text).not.toContain("provenance downgrade");
  expect(text).not.toContain("known malware");
});

test("-v and the bare help verb are accepted like their long forms", async () => {
  const short = makeDeps();
  expect(await runWarden(["-v"], short.deps)).toBe(0);
  expect(short.out.join("")).toBe(`${ANALYZER_VERSION}\n`);

  const help = makeDeps();
  expect(await runWarden(["help"], help.deps)).toBe(0);
  expect(help.err.join("")).toContain("usage: warden <verb> [flags]");

  const empty = makeDeps();
  expect(await runWarden([], empty.deps)).toBe(0);
  expect(empty.err.join("")).toContain("usage: warden <verb> [flags]");
});
