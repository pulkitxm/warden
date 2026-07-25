import { expect, test } from "bun:test";
import { join } from "node:path";
import { baselinesFor, renderBaselines } from "../../src/cli/commands/baseline.ts";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import type { TransactionReceipt } from "../../src/graph/receipt.ts";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";

const CWD = "/repo";
const LOCK = JSON.stringify({
  packages: {
    "": {},
    "node_modules/left-pad": { version: "1.3.0" },
    "node_modules/chalk": { version: "5.0.0" },
  },
});

const receipt = (over: Partial<TransactionReceipt> = {}): TransactionReceipt => ({
  schema_version: 1,
  transaction_id: "wtxn_t",
  plan_id: "wtxn_p",
  command: "npm install chalk",
  manager: { name: "npm" },
  graph_before: "sha256:a",
  graph_after: "sha256:b",
  policy_digest: "sha256:p",
  artifacts: [
    {
      package: "chalk",
      version: "5.3.0",
      verdict: "allow",
      summary: "no findings",
      categories: [],
    },
  ],
  approvals: [],
  suppressed_scripts: [],
  verification: { install: "pass", test: "pass", typecheck: "skipped", build: "skipped" },
  result: "applied",
  analyzer_version: "test",
  ...over,
});

function makeDeps(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const store = { ...files };
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    cwd: () => CWD,
    home: "/home/u",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    exists: (path) => path in store,
    readFile: (path) => {
      if (!(path in store)) throw new Error(`ENOENT ${path}`);
      return store[path] as string;
    },
    mkdir: () => undefined,
    writeFile: (path, data) => {
      written[path] = data;
      store[path] = data;
    },
    check: () => Promise.reject(new Error("unused")),
  };
  return { deps, out, err, written };
}

test("listing derives a baseline for every installed package", async () => {
  const { deps, out } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  expect(await runWarden(["baseline", "list", "--json"], deps)).toBe(0);
  const baselines = JSON.parse(out[0] as string).baselines;
  expect(baselines.map((row: { package: string }) => row.package)).toEqual(["chalk", "left-pad"]);
  expect(baselines[0].source).toBe("lockfile");
});

test("bare baseline behaves as list", async () => {
  setColor(false);
  const { deps, err } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  expect(await runWarden(["baseline"], deps)).toBe(0);
  expect(err.join("")).toContain("Trusted baselines");
});

test("a verified receipt outranks the lockfile as the trusted version", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(receipt()),
  });
  await runWarden(["baseline", "list", "--json"], deps);
  const baselines = JSON.parse(out[0] as string).baselines;
  const chalk = baselines.find((row: { package: string }) => row.package === "chalk");
  expect(chalk).toMatchObject({ version: "5.3.0", source: "receipt" });
});

test("a receipt that was not applied does not become a baseline", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(receipt({ result: "refused" })),
  });
  await runWarden(["baseline", "list", "--json"], deps);
  const chalk = JSON.parse(out[0] as string).baselines.find(
    (row: { package: string }) => row.package === "chalk",
  );
  expect(chalk.source).toBe("lockfile");
});

test("a blocked artifact in a receipt does not become a baseline either", async () => {
  const { deps, out } = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, ".warden", "last-receipt.json")]: JSON.stringify(
      receipt({
        artifacts: [
          {
            package: "chalk",
            version: "9.9.9",
            verdict: "block",
            summary: "malware",
            categories: [],
          },
        ],
      }),
    ),
  });
  await runWarden(["baseline", "list", "--json"], deps);
  const chalk = JSON.parse(out[0] as string).baselines.find(
    (row: { package: string }) => row.package === "chalk",
  );
  expect(chalk.version).toBe("5.0.0");
});

test("recording a baseline writes it and it then wins over the lockfile", async () => {
  const { deps, written, out } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  expect(await runWarden(["baseline", "record", "left-pad@1.2.0", "--json"], deps)).toBe(0);
  expect(JSON.parse(out[0] as string)).toMatchObject({ package: "left-pad", version: "1.2.0" });
  expect(written[join(CWD, ".warden", "baselines.json")]).toContain("left-pad");

  const second = makeDeps({
    [join(CWD, "package-lock.json")]: LOCK,
    [join(CWD, ".warden", "baselines.json")]: written[
      join(CWD, ".warden", "baselines.json")
    ] as string,
  });
  await runWarden(["baseline", "list", "--json"], second.deps);
  const leftPad = JSON.parse(second.out[0] as string).baselines.find(
    (row: { package: string }) => row.package === "left-pad",
  );
  expect(leftPad).toMatchObject({ version: "1.2.0", source: "recorded" });
});

test("a note is recorded with the baseline", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["baseline", "record", "esbuild@0.25.8", "--note", "audited", "--json"], deps);
  expect(JSON.parse(out[0] as string).note).toBe("audited");
});

test("recording without a version is refused, because a range is not a baseline", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["baseline", "record", "left-pad", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_BASELINE_USAGE");
});

test("recording a range rather than an exact version is refused", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["baseline", "record", "left-pad@", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_BASELINE_USAGE");
});

test("an unwritable project is reported rather than silently losing the baseline", async () => {
  const { deps, out } = makeDeps();
  deps.writeFile = () => {
    throw new Error("read-only");
  };
  expect(await runWarden(["baseline", "record", "left-pad@1.3.0", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_BASELINE_WRITE");
});

test("an unknown subcommand is rejected", async () => {
  const { deps, out } = makeDeps();
  expect(await runWarden(["baseline", "nonsense", "--json"], deps)).toBe(30);
  expect(JSON.parse(out[0] as string).error.code).toBe("WARDEN_BASELINE_VERB");
});

test("a project with nothing installed lists nothing rather than inventing baselines", async () => {
  const { deps, out } = makeDeps();
  await runWarden(["baseline", "list", "--json"], deps);
  expect(JSON.parse(out[0] as string).baselines).toEqual([]);
});

test("--quiet suppresses both the listing and the confirmation", async () => {
  setVerbosity("quiet");
  const { deps, err } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  await runWarden(["baseline", "list"], deps);
  await runWarden(["baseline", "record", "left-pad@1.3.0"], deps);
  expect(err.join("")).toBe("");
  setVerbosity("normal");
});

test("the human listing grades each baseline by how much it is worth trusting", () => {
  setColor(false);
  const { deps } = makeDeps({ [join(CWD, "package-lock.json")]: LOCK });
  const text = renderBaselines(baselinesFor(deps, CWD, ["left-pad", "unknown-pkg"]));
  expect(text).toContain("moderate");
  expect(text).toContain("none");
  expect(text).toContain("actually running");
  expect(text).toContain("the previous published release is the weak fallback");
});

test("an empty listing says so instead of printing a bare heading", () => {
  setColor(false);
  expect(renderBaselines([])).toContain("no baseline is known");
});

test("the recorded confirmation explains what the baseline changes", async () => {
  setColor(false);
  const { deps, err } = makeDeps();
  await runWarden(["baseline", "record", "left-pad@1.3.0"], deps);
  expect(err.join("")).toContain("recorded left-pad@1.3.0 as a trusted baseline");
  expect(err.join("")).toContain("rather than against whatever was published before it");
});
