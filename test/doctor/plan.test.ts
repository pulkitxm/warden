import { expect, test } from "bun:test";
import {
  candidateOrder,
  changeFor,
  type DepAudit,
  issuesOf,
  safeUpgrades,
  sameChanges,
} from "../../src/doctor/plan.ts";
import type { OsvVuln } from "../../src/vuln.ts";

const vuln = (fixed?: string): OsvVuln => ({
  id: "GHSA-PLAN-0001",
  summary: "demo advisory",
  database_specific: { severity: "high" },
  affected: [
    {
      package: { ecosystem: "npm", name: "demo" },
      ranges: [
        {
          type: "SEMVER",
          events: [{ introduced: "1.0.0" }, ...(fixed ? [{ fixed }] : [])],
        },
      ],
    },
  ],
});

const audit = (over: Partial<DepAudit> = {}): DepAudit => ({
  name: "demo",
  range: "^1.0.0",
  group: "prod",
  installed: "1.0.0",
  versions: ["0.9.0", "1.0.0", "1.0.5", "1.2.0", "2.0.0", "2.1.0-beta.1"],
  vulns: [vuln("1.0.5")],
  deprecated: false,
  notes: [],
  ...over,
});

test("issuesOf reports affecting advisories with the first newer fixed version", () => {
  const issues = issuesOf(audit());
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    name: "demo",
    kind: "vulnerability",
    id: "GHSA-PLAN-0001",
    severity: "high",
    fixedIn: "1.0.5",
  });
});

test("issuesOf skips advisories that do not affect the installed version", () => {
  expect(issuesOf(audit({ installed: "1.0.5" }))).toEqual([]);
});

test("issuesOf without an installed version reports nothing for advisories", () => {
  expect(issuesOf(audit({ installed: undefined }))).toEqual([]);
});

test("issuesOf reports deprecated packages", () => {
  const issues = issuesOf(audit({ vulns: [], deprecated: true }));
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ kind: "deprecated" });
});

test("safeUpgrades keeps only newer, stable, unaffected versions", () => {
  expect(safeUpgrades(audit())).toEqual(["1.0.5", "1.2.0", "2.0.0"]);
  expect(safeUpgrades(audit({ vulns: [vuln()] }))).toEqual([]);
  expect(safeUpgrades(audit({ installed: undefined }))).toEqual([]);
  expect(safeUpgrades(audit({ versions: ["1.0.0", "bogus"] }))).toEqual([]);
});

test("candidateOrder prefers in-range versions for minimal and newest-first for latest", () => {
  expect(candidateOrder(audit(), "minimal")).toEqual(["1.0.5", "1.2.0", "2.0.0"]);
  expect(candidateOrder(audit({ range: "~1.0.0" }), "minimal")).toEqual([
    "1.0.5",
    "1.2.0",
    "2.0.0",
  ]);
  expect(candidateOrder(audit(), "latest")).toEqual(["2.0.0", "1.2.0", "1.0.5"]);
});

test("changeFor labels range membership and upgrade level", () => {
  expect(changeFor(audit(), "1.0.5")).toEqual({
    name: "demo",
    from: "1.0.0",
    to: "1.0.5",
    inRange: true,
    level: "patch",
  });
  expect(changeFor(audit(), "2.0.0")).toMatchObject({ inRange: false, level: "major" });
  expect(changeFor(audit(), "1.2.0")).toMatchObject({ inRange: true, level: "minor" });
});

test("sameChanges compares name/target pairs positionally", () => {
  const a = changeFor(audit(), "1.0.5");
  const b = changeFor(audit(), "2.0.0");
  expect(sameChanges([a], [a])).toBe(true);
  expect(sameChanges([a], [b])).toBe(false);
  expect(sameChanges([a], [a, b])).toBe(false);
});
