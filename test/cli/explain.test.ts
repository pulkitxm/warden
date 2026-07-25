import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComparison } from "../../src/cli/commands/compare.ts";
import { renderExplain } from "../../src/cli/commands/explain.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { hashScript } from "../../src/graph/approvals.ts";
import type { Category, Verdict } from "../../src/schema.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";
const HOME = "/home/u";
const SCRIPT = "node build.js";

const PACKUMENTS: Record<string, unknown> = {
  "left-pad": {
    name: "left-pad",
    "dist-tags": { latest: "1.3.0" },
    time: {
      "1.0.0": "2020-01-01T00:00:00.000Z",
      "1.2.0": "2021-01-01T00:00:00.000Z",
      "1.3.0": "2022-01-01T00:00:00.000Z",
    },
    versions: {
      "1.0.0": { version: "1.0.0", dist: { tarball: "t", integrity: "sha512-a" } },
      "1.2.0": { version: "1.2.0", dist: { tarball: "t", integrity: "sha512-b" } },
      "1.3.0": { version: "1.3.0", dist: { tarball: "t", integrity: "sha512-c" } },
    },
    maintainers: [{ name: "dev" }],
  },
  esbuild: {
    name: "esbuild",
    "dist-tags": { latest: "0.25.8" },
    time: { "0.25.8": "2026-01-01T00:00:00.000Z" },
    versions: {
      "0.25.8": {
        version: "0.25.8",
        scripts: { postinstall: SCRIPT },
        dist: { tarball: "t", integrity: "sha512-esbuild" },
      },
    },
    maintainers: [{ name: "dev" }],
  },
};

let server: ReturnType<typeof Bun.serve>;
const saved = { registry: process.env.WNPM_REGISTRY, downloads: process.env.WNPM_DOWNLOADS };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
      if (path.startsWith("downloads/")) return Response.json({ downloads: 1234 });
      const packument = PACKUMENTS[path];
      return packument ? Response.json(packument) : new Response("nope", { status: 404 });
    },
  });
  process.env.WNPM_REGISTRY = `http://localhost:${server.port}`;
  process.env.WNPM_DOWNLOADS = `http://localhost:${server.port}/downloads`;
});

afterAll(() => {
  server.stop(true);
  for (const [key, value] of [
    ["WNPM_REGISTRY", saved.registry],
    ["WNPM_DOWNLOADS", saved.downloads],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function verdictFor(spec: string, level: Verdict["verdict"] = "allow"): Verdict {
  const parts = spec.split("@").filter(Boolean);
  return {
    schema_version: 1,
    package: parts[0] as string,
    version: parts[1] ?? "1.3.0",
    integrity: "sha512-x",
    verdict: level,
    risk_score: level === "block" ? 88 : 0,
    categories: level === "block" ? (["known_malware"] as Category[]) : [],
    summary: level === "block" ? "known malware" : "no findings",
    evidence: level === "block" ? [{ file: "index.js", line: 3, detail: "exfil" }] : [],
    analyzer_version: "test",
    source: "heuristics",
  };
}

function makeDeps(files: Record<string, string> = {}, levels: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: HOME,
    cwd: () => CWD,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in files,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    check: (spec) => {
      const name = spec.split("@").filter(Boolean)[0] as string;
      if (levels[name] === "throw") return Promise.reject(new Error("registry unreachable"));
      return Promise.resolve(verdictFor(spec, (levels[name] ?? "allow") as Verdict["verdict"]));
    },
  };
  return { deps, out, err };
}

test("explain returns the package's exit code, not merely a report", async () => {
  const { deps } = makeDeps();
  expect(await runWarden(["explain", "left-pad@1.3.0", "--json"], deps)).toBe(0);
  const blocked = makeDeps({}, { evil: "block" });
  expect(await runWarden(["explain", "evil@1.0.0", "--json"], blocked.deps)).toBe(20);
});

test("explain --json carries the decision, confidence, and reason codes", async () => {
  const { deps, out } = makeDeps({}, { evil: "block" });
  await runWarden(["explain", "evil@1.0.0", "--json"], deps);
  const report = JSON.parse(out[0] as string);
  expect(report).toMatchObject({ decision: "block", confidence: "high" });
  expect(report.reason_codes).toEqual(["known_malware"]);
  expect(report.prevented.length).toBeGreaterThan(0);
});

test("explaining without a package name is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["explain", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_EXPLAIN_USAGE");
});

test("an analysis failure while explaining is reported as an error, not an allow", async () => {
  const { deps, out } = makeDeps({}, { broken: "throw" });
  expect(await runWarden(["explain", "broken", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_EXPLAIN_ERROR");
});

test("a name that is not published is named as such, never as a first release", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["explain", "unpublished@1.0.0", "--json"], deps);
  expect(JSON.parse(out[0] as string).what_changed).toEqual([
    "this name is not published on the registry",
  ]);
});

test("history lists releases newest first and respects --tail", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["history", "left-pad", "--tail", "2", "--json"], deps)).toBe(0);
  const payload = JSON.parse(out[0] as string);
  expect(payload.entries.map((entry: { version: string }) => entry.version)).toEqual([
    "1.3.0",
    "1.2.0",
  ]);
  expect(payload.latest).toBe("1.3.0");
});

test("a non-numeric tail falls back to the default rather than showing nothing", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["history", "left-pad", "--tail", "abc", "--json"], deps);
  expect(JSON.parse(out[0] as string).entries).toHaveLength(3);
});

test("history without a package name is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["history", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_HISTORY_USAGE");
});

test("a package that is not published is reported as such rather than as an empty history", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["history", "not-a-real-package", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_HISTORY_UNKNOWN");
});

test("an unreachable registry fails history rather than returning nothing", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const { deps, out } = makeDeps();
  const code = await runWarden(["history", "left-pad", "--json"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_HISTORY_ERROR");
});

test("comparing ranks candidates and never installs one", async () => {
  const { deps, out } = makeDeps({}, { esbuild: "block" });
  expect(await runWarden(["compare", "esbuild", "left-pad", "--json"], deps)).toBe(0);
  const candidates = JSON.parse(out[0] as string).candidates;
  expect(candidates[0].package).toBe("left-pad");
  expect(candidates[1].decision).toBe("block");
});

test("comparing fewer than two candidates is a usage error", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["compare", "left-pad", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_COMPARE_USAGE");
});

test("a candidate that cannot be analyzed is compared as unknown rather than dropped", async () => {
  const { deps, out } = makeDeps({}, { broken: "throw" });
  await runWarden(["compare", "broken", "left-pad", "--json"], deps);
  const candidates = JSON.parse(out[0] as string).candidates;
  expect(candidates).toHaveLength(2);
  expect(candidates.find((row: { package: string }) => row.package === "broken").decision).toBe(
    "unknown",
  );
});

const LOCK = JSON.stringify({
  packages: { "": {}, "node_modules/esbuild": { version: "0.25.8" } },
});

test("pending scripts lists what is installed and still unapproved, exiting 10", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, "node_modules", "esbuild", "package.json")]: JSON.stringify({
      scripts: { postinstall: SCRIPT },
    }),
  });
  expect(await runWarden(["scripts", "pending", "--json"], deps)).toBe(10);
  const payload = JSON.parse(out[0] as string);
  expect(payload.scripts).toEqual([
    { package: "esbuild", version: "0.25.8", hooks: ["postinstall"], approved: false },
  ]);
});

test("an approved script stops being pending and the command exits 0", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, "node_modules", "esbuild", "package.json")]: JSON.stringify({
      scripts: { postinstall: SCRIPT },
    }),
    [join(CWD, ".warden", "approvals.json")]: JSON.stringify({
      schema_version: 1,
      approvals: [
        {
          schema_version: 1,
          package: "esbuild",
          version: "0.25.8",
          integrity: "sha512-esbuild",
          hook: "postinstall",
          script_hash: hashScript(SCRIPT),
          scope: "repo",
          approved_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  });
  expect(await runWarden(["scripts", "pending", "--json"], deps)).toBe(0);
  expect(JSON.parse(out[0] as string).scripts[0].approved).toBe(true);
});

test("a project with no install scripts at all exits 0 and says so", async () => {
  setColor(false);
  const { deps, err, out } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  expect(await runWarden(["scripts", "pending"], deps)).toBe(0);
  expect(err.join("")).toContain("no installed package declares a lifecycle script");
  expect(out).toEqual([]);
});

test("an unknown scripts subcommand is rejected instead of silently listing", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["scripts", "nope", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_SCRIPTS_USAGE");
});

test("explain survives a registry outage as long as the verdict itself resolved", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const { deps, out } = makeDeps();
  const code = await runWarden(["explain", "left-pad@1.3.0", "--json"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(0);
  expect(JSON.parse(out[0] as string).what_changed).toEqual([]);
});

test("comparing survives a registry outage and still ranks on the verdicts", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const { deps, out } = makeDeps({}, { esbuild: "block" });
  await runWarden(["compare", "esbuild", "left-pad", "--json"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(JSON.parse(out[0] as string).candidates[0].package).toBe("left-pad");
});

test("the human history marks the current release and counts the published ones", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  expect(await runWarden(["history", "left-pad"], deps)).toBe(0);
  const text = err.join("");
  expect(text).toContain("left-pad release history");
  expect(text).toContain("→ 1.3.0");
  expect(text).toContain("3 published releases");
});

test("the human script inventory shows the approval command for each pending hook", async () => {
  setColor(false);
  const { deps, err } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, "node_modules", "esbuild", "package.json")]: JSON.stringify({
      scripts: { postinstall: SCRIPT },
    }),
  });
  expect(await runWarden(["scripts", "pending"], deps)).toBe(10);
  const text = err.join("");
  expect(text).toContain("pending");
  expect(text).toContain("warden approve-script esbuild@0.25.8 --hook postinstall");
  expect(text).toContain("read from package-lock.json");
});

test("the human comparison renders without json", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["compare", "left-pad", "esbuild"], deps);
  expect(err.join("")).toContain("Candidate comparison");
});

test("two scripted packages are listed in a stable order even with the registry down", async () => {
  const previous = process.env.WNPM_REGISTRY;
  process.env.WNPM_REGISTRY = "http://127.0.0.1:1";
  const lock = JSON.stringify({
    packages: {
      "": {},
      "node_modules/zod": { version: "3.0.0" },
      "node_modules/esbuild": { version: "0.25.8" },
    },
  });
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: lock,
    [join(CWD, "node_modules", "esbuild", "package.json")]: JSON.stringify({
      scripts: { postinstall: SCRIPT },
    }),
    [join(CWD, "node_modules", "zod", "package.json")]: JSON.stringify({
      scripts: { install: "node z.js" },
    }),
  });
  const code = await runWarden(["scripts", "pending", "--json"], deps);
  process.env.WNPM_REGISTRY = previous;
  expect(code).toBe(10);
  expect(
    JSON.parse(out[0] as string).scripts.map((entry: { package: string }) => entry.package),
  ).toEqual(["esbuild", "zod"]);
});

test("--quiet suppresses every human report in this family", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps();
  await runWarden(["explain", "left-pad@1.3.0"], deps);
  await runWarden(["history", "left-pad"], deps);
  await runWarden(["compare", "left-pad", "esbuild"], deps);
  await runWarden(["scripts", "pending"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("the rendered explanation answers all four questions in order", () => {
  setColor(false);
  const text = renderExplain({
    schema_version: 1,
    package: "react-codeshift",
    version: "0.1.0",
    decision: "block",
    confidence: "high",
    reason_codes: ["slopsquat"],
    what_changed: ["react-codeshift@0.1.0 is the first release seen here"],
    why_it_matters: ["the name matches a pattern language models are known to invent"],
    prevented: ["the install script did not execute"],
    next_actions: ["warden compare react-codeshift jscodeshift"],
    baseline: null,
    heuristic_score: 62,
    evidence: Array.from({ length: 10 }, (_, index) => ({
      file: `f${index}.js`,
      line: index,
      detail: "finding",
    })),
    analyzer_version: "0.1.0",
  });
  expect(text.indexOf("What changed")).toBeLessThan(text.indexOf("Why that matters"));
  expect(text.indexOf("Why that matters")).toBeLessThan(text.indexOf("Prevented"));
  expect(text.indexOf("Prevented")).toBeLessThan(text.indexOf("Safe next action"));
  expect(text).toContain("and 2 more findings");
  expect(text).toContain("heuristic score 62/100");
  expect(text).toContain("baseline: none");
});

test("the rendered comparison states that warden will not choose for you", () => {
  setColor(false);
  const text = renderComparison([
    {
      package: "jscodeshift",
      version: "17.0.0",
      decision: "allow",
      weeklyDownloads: 2_500_000,
      ageDays: 400,
      hasProvenance: true,
      installScripts: [],
      deprecated: false,
      summary: "no findings",
    },
    {
      package: "react-codeshift",
      version: "unknown",
      decision: "unknown",
      installScripts: ["postinstall"],
      deprecated: true,
      summary: "not analyzed",
    },
  ]);
  expect(text).toContain("2,500,000 weekly downloads");
  expect(text).toContain("downloads unknown");
  expect(text).toContain("age unknown");
  expect(text).toContain("deprecated");
  expect(text).toContain("never installs an alternative for you");
});
