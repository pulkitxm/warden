import { afterAll, beforeAll, expect, test } from "bun:test";
import { osvRecord } from "../fixtures/registry/fixtures.ts";
import { type MiniRegistry, startMiniRegistry } from "../fixtures/registry/server.ts";
import {
  affectsVersion,
  fetchVulns,
  fixedVersions,
  type OsvVuln,
  severityOf,
  summaryOf,
} from "../src/vuln.ts";

let reg: MiniRegistry;

beforeAll(() => {
  reg = startMiniRegistry();
  process.env.WNPM_OSV = reg.url;
});
afterAll(() => {
  reg.stop();
  delete process.env.WNPM_OSV;
});

test("fetchVulns returns advisories for a vulnerable fixture package", async () => {
  const vulns = await fetchVulns("acme-http");
  expect(vulns).not.toBeNull();
  expect(vulns?.map((v) => v.id)).toEqual(["GHSA-ACME-HTTP-0001"]);
});

test("fetchVulns returns an empty list for a clean package", async () => {
  expect(await fetchVulns("left-pad")).toEqual([]);
});

test("fetchVulns returns null on HTTP errors and network failures", async () => {
  process.env.WNPM_OSV = `${reg.url}/missing`;
  expect(await fetchVulns("acme-http")).toBeNull();
  process.env.WNPM_OSV = "http://127.0.0.1:1";
  expect(await fetchVulns("acme-http")).toBeNull();
  process.env.WNPM_OSV = reg.url;
});

const vuln = (over: Partial<OsvVuln> = {}): OsvVuln => ({
  id: "GHSA-TEST-0001",
  affected: [
    {
      package: { ecosystem: "npm", name: "demo" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.2.0" }] }],
    },
  ],
  ...over,
});

test("affectsVersion evaluates SEMVER introduced/fixed ranges", () => {
  const v = vuln();
  expect(affectsVersion(v, "demo", "1.0.0")).toBe(true);
  expect(affectsVersion(v, "demo", "1.1.9")).toBe(true);
  expect(affectsVersion(v, "demo", "1.2.0")).toBe(false);
  expect(affectsVersion(v, "demo", "0.9.0")).toBe(false);
  expect(affectsVersion(v, "other", "1.1.0")).toBe(false);
  expect(affectsVersion(v, "demo", "not-a-version")).toBe(false);
});

test("affectsVersion handles introduced=0, last_affected, explicit versions, and other ecosystems", () => {
  const zero = vuln({
    affected: [
      {
        package: { name: "demo" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }],
      },
    ],
  });
  expect(affectsVersion(zero, "demo", "99.0.0")).toBe(true);

  const last = vuln({
    affected: [
      {
        package: { ecosystem: "npm", name: "demo" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { last_affected: "1.1.0" }] }],
      },
    ],
  });
  expect(affectsVersion(last, "demo", "1.1.0")).toBe(true);
  expect(affectsVersion(last, "demo", "1.1.1")).toBe(false);

  const listed = vuln({
    affected: [{ package: { ecosystem: "npm", name: "demo" }, versions: ["3.3.3"] }],
  });
  expect(affectsVersion(listed, "demo", "3.3.3")).toBe(true);
  expect(affectsVersion(listed, "demo", "3.3.4")).toBe(false);

  const pypi = vuln({
    affected: [
      {
        package: { ecosystem: "PyPI", name: "demo" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }],
      },
    ],
  });
  expect(affectsVersion(pypi, "demo", "1.0.0")).toBe(false);

  const git = vuln({
    affected: [
      {
        package: { ecosystem: "npm", name: "demo" },
        ranges: [{ type: "GIT", events: [{ introduced: "0" }] }],
      },
    ],
  });
  expect(affectsVersion(git, "demo", "1.0.0")).toBe(false);

  expect(affectsVersion({ id: "GHSA-EMPTY" }, "demo", "1.0.0")).toBe(false);

  const unbounded = vuln({
    affected: [
      {
        package: { ecosystem: "npm", name: "demo" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "garbage" }, { fixed: "junk" }] }],
      },
    ],
  });
  expect(affectsVersion(unbounded, "demo", "1.0.0")).toBe(true);
});

test("fixedVersions collects, validates, and sorts fixed events", () => {
  const multi = vuln({
    affected: [
      {
        package: { ecosystem: "npm", name: "demo" },
        ranges: [
          { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.0" }] },
          { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.0" }, { fixed: "bad" }] },
        ],
      },
    ],
  });
  expect(fixedVersions(multi, "demo")).toEqual(["1.2.0", "2.0.0"]);
  expect(fixedVersions({ id: "GHSA-NONE" }, "demo")).toEqual([]);
});

test("severityOf prefers database labels, then CVSS, then unknown", () => {
  expect(severityOf(vuln({ database_specific: { severity: "HIGH" } }))).toBe("high");
  expect(severityOf(vuln({ severity: [{ type: "CVSS_V3", score: "9.8" }] }))).toBe("CVSS_V3 9.8");
  expect(severityOf(vuln({ severity: [{ type: "CVSS_V3" }] }))).toBe("unknown");
  expect(severityOf(vuln())).toBe("unknown");
});

test("summaryOf falls back from summary to details to id", () => {
  expect(summaryOf(vuln({ summary: "short" }))).toBe("short");
  expect(summaryOf(vuln({ details: "line one\nline two" }))).toBe("line one");
  expect(summaryOf(vuln())).toBe("GHSA-TEST-0001");
});

test("osvRecord shapes fixture advisories like OSV, with and without a fixed event", () => {
  const withFix = osvRecord({
    id: "X",
    package: "p",
    summary: "s",
    severity: "low",
    introduced: "0",
    fixed: "1.0.0",
  });
  expect(fixedVersions(withFix, "p")).toEqual(["1.0.0"]);
  const noFix = osvRecord({
    id: "Y",
    package: "p",
    summary: "s",
    severity: "low",
    introduced: "0",
  });
  expect(fixedVersions(noFix, "p")).toEqual([]);
  expect(affectsVersion(noFix, "p", "9.9.9")).toBe(true);
});
