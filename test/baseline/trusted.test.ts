import { expect, test } from "bun:test";
import {
  BASELINE_FILE,
  type BaselineFs,
  baselinePath,
  baselineStrength,
  isUpgrade,
  readBaselines,
  recordBaseline,
  resolveBaseline,
} from "../../src/baseline/trusted.ts";

function fsWith(files: Record<string, string> = {}) {
  const store = { ...files };
  return {
    store,
    fs: {
      exists: (path) => path in store,
      readFile: (path) => {
        if (!(path in store)) throw new Error(`ENOENT ${path}`);
        return store[path] as string;
      },
      writeFile: (path, data) => {
        store[path] = data;
      },
      mkdir: () => undefined,
    } satisfies BaselineFs,
  };
}

const inputs = (over: Partial<Parameters<typeof resolveBaseline>[1]> = {}) => ({
  recorded: [],
  installed: new Map<string, { version: string }>(),
  receipts: new Map<string, string>(),
  ...over,
});

test("an explicitly recorded baseline wins over everything else", () => {
  const baseline = resolveBaseline(
    "left-pad",
    inputs({
      recorded: [{ package: "left-pad", version: "1.2.0", recordedAt: "2026-01-01T00:00:00.000Z" }],
      installed: new Map([["left-pad", { version: "1.3.0" }]]),
      receipts: new Map([["left-pad", "1.4.0"]]),
      previousRelease: "1.5.0",
    }),
  );
  expect(baseline).toMatchObject({ version: "1.2.0", source: "recorded" });
  expect(baseline.evidence).toContain("2026-01-01");
});

test("a version a verified transaction installed beats the lockfile", () => {
  const baseline = resolveBaseline(
    "chalk",
    inputs({
      installed: new Map([["chalk", { version: "5.0.0" }]]),
      receipts: new Map([["chalk", "5.3.0"]]),
    }),
  );
  expect(baseline).toMatchObject({ version: "5.3.0", source: "receipt" });
});

test("the lockfile is the baseline when nothing stronger exists", () => {
  const baseline = resolveBaseline(
    "zod",
    inputs({ installed: new Map([["zod", { version: "3.22.0" }]]), previousRelease: "3.23.0" }),
  );
  expect(baseline).toMatchObject({ version: "3.22.0", source: "lockfile" });
  expect(baseline.evidence).toContain("actually running");
});

test("the previous published release is the last resort and says why it is weak", () => {
  const baseline = resolveBaseline("new-thing", inputs({ previousRelease: "0.9.0" }));
  expect(baseline).toMatchObject({ version: "0.9.0", source: "previous-release" });
  expect(baseline.evidence).toContain("publish twice");
});

test("a package with no known good version reports none rather than guessing", () => {
  const baseline = resolveBaseline("brand-new", inputs());
  expect(baseline).toMatchObject({ version: "", source: "none" });
  expect(baseline.evidence).toContain("no trusted version");
});

test("baseline strength ranks a recorded version above a lockfile above a published one", () => {
  expect(baselineStrength("recorded")).toBe("strong");
  expect(baselineStrength("receipt")).toBe("strong");
  expect(baselineStrength("lockfile")).toBe("moderate");
  expect(baselineStrength("previous-release")).toBe("weak");
  expect(baselineStrength("none")).toBe("none");
});

test("a newer version is an upgrade relative to the baseline", () => {
  const baseline = resolveBaseline(
    "x",
    inputs({ installed: new Map([["x", { version: "1.0.0" }]]) }),
  );
  expect(isUpgrade(baseline, "1.0.1")).toBe(true);
  expect(isUpgrade(baseline, "1.0.0")).toBe(false);
  expect(isUpgrade(baseline, "0.9.0")).toBe(false);
});

test("with no baseline at all everything counts as an upgrade", () => {
  expect(isUpgrade(resolveBaseline("x", inputs()), "0.0.1")).toBe(true);
});

test("baselines survive a write and read round trip", () => {
  const { fs, store } = fsWith();
  recordBaseline(fs, "/repo", {
    package: "left-pad",
    version: "1.3.0",
    recordedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(Object.keys(store)).toContain(baselinePath("/repo"));
  expect(readBaselines(fs, "/repo")).toHaveLength(1);
});

test("re-recording a package replaces its baseline rather than stacking one", () => {
  const { fs } = fsWith();
  recordBaseline(fs, "/repo", {
    package: "left-pad",
    version: "1.3.0",
    recordedAt: "2026-01-01T00:00:00.000Z",
  });
  const rows = recordBaseline(fs, "/repo", {
    package: "left-pad",
    version: "1.4.0",
    recordedAt: "2026-02-01T00:00:00.000Z",
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.version).toBe("1.4.0");
});

test("baselines are stored sorted so the file does not churn", () => {
  const { fs } = fsWith();
  recordBaseline(fs, "/repo", { package: "zod", version: "1", recordedAt: "t" });
  const rows = recordBaseline(fs, "/repo", { package: "acorn", version: "1", recordedAt: "t" });
  expect(rows.map((row) => row.package)).toEqual(["acorn", "zod"]);
});

test("a note is preserved with the baseline", () => {
  const { fs } = fsWith();
  const rows = recordBaseline(fs, "/repo", {
    package: "esbuild",
    version: "0.25.8",
    recordedAt: "t",
    note: "audited in PR 412",
  });
  expect(rows[0]?.note).toBe("audited in PR 412");
});

test("a missing or corrupt baseline file reads as no baselines, never as a wildcard", () => {
  expect(readBaselines(fsWith().fs, "/repo")).toEqual([]);
  expect(readBaselines(fsWith({ [baselinePath("/repo")]: "{bad" }).fs, "/repo")).toEqual([]);
  expect(
    readBaselines(
      fsWith({ [baselinePath("/repo")]: JSON.stringify({ baselines: 1 }) }).fs,
      "/repo",
    ),
  ).toEqual([]);
});

test("the baseline file lives under .warden so it is committed with the project", () => {
  expect(BASELINE_FILE).toContain(".warden");
  expect(baselinePath("/repo")).toBe(`/repo/${BASELINE_FILE}`);
});
