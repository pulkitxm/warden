import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultWardenDeps, runWarden, type WardenDeps } from "../../src/cli/main.ts";
import { SCHEMA_VERSION, type Verdict } from "../../src/schema.ts";

const gitCleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

function spawnGit(args: string[], cwd: string) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitCleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function write(root: string, path: string, data = "") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

function packageJson(value: object) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function verdict(spec: string, level: Verdict["verdict"] = "allow"): Verdict {
  const split = spec.lastIndexOf("@");
  const name = split > 0 ? spec.slice(0, split) : spec;
  const version = split > 0 ? spec.slice(split + 1) : "1.0.0";
  return {
    schema_version: SCHEMA_VERSION,
    package: name,
    version,
    integrity: "sha512-test",
    verdict: level,
    risk_score: level === "block" ? 90 : level === "warn" ? 40 : 0,
    categories: level === "allow" ? [] : [level === "block" ? "typosquat" : "metadata_anomaly"],
    summary: `${level} summary`,
    evidence: level === "allow" ? [] : [{ file: "package.json", detail: `${level} evidence` }],
    analyzer_version: "0.1.0",
    source: "heuristics",
  };
}

function makeDeps(root: string, over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    git: spawnGit,
    home: join(root, "home"),
    cwd: () => root,
    stdout: (value) => out.push(value),
    stderr: (value) => err.push(value),
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, data) => writeFileSync(path, data),
    exists: existsSync,
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    glob: (pattern, cwd) => [...new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: false })],
    check: (spec) => Promise.resolve(verdict(spec)),
    isTTY: () => false,
    prompt: async (question) => {
      prompts.push(question);
      return "";
    },
    ...over,
  };
  return { deps, out, err, prompts };
}

async function inTemp(body: (root: string) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(), "warden-verbs-"));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("schema prints check and CI schemas, help, and typed errors", async () => {
  await inTemp(async (root) => {
    const state = makeDeps(root);
    expect(await runWarden(["schema"], state.deps)).toBe(0);
    expect(JSON.parse(state.out.pop()!).properties.verdict).toBeDefined();
    expect(await runWarden(["schema", "ci"], state.deps)).toBe(0);
    expect(JSON.parse(state.out.pop()!).type).toBe("array");
    expect(await runWarden(["schema", "--help"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("usage: warden schema");
    expect(await runWarden(["schema", "missing"], state.deps)).toBe(30);
    expect(JSON.parse(state.out.pop()!).error.code).toBe("WARDEN_UNKNOWN_SCHEMA");
  });
});

test("log supports human output, tail, raw JSON, missing files, and malformed lines", async () => {
  await inTemp(async (root) => {
    const state = makeDeps(root);
    expect(await runWarden(["log"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("no recorded verdicts");
    write(state.deps.home, ".warden/log.jsonl", "");
    expect(await runWarden(["log"], state.deps)).toBe(0);
    write(
      state.deps.home,
      ".warden/log.jsonl",
      '{"timestamp":"2026-07-13T16:41:01Z","verdict":"allow","package":"express","version":"5.1.0","risk_score":4}\nnot-json\n{"timestamp":"2026-07-13T16:41:02Z","verdict":"block","package":"expres","version":"0.0.5","risk_score":92,"categories":["typosquat"]}\n',
    );
    state.err.length = 0;
    expect(await runWarden(["log", "--tail", "2"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("skipped malformed log entry");
    expect(state.err.join("")).toContain(
      "2026-07-13T16:41:02Z BLOCK expres@0.0.5 risk=92 typosquat",
    );
    expect(await runWarden(["log", "--tail", "1", "--json"], state.deps)).toBe(0);
    expect(JSON.parse(state.out.pop()!).package).toBe("expres");
    state.err.length = 0;
    expect(await runWarden(["log", "--tail", "0"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("no recorded verdicts");
    expect(await runWarden(["log", "--help"], state.deps)).toBe(0);
    expect(await runWarden(["log", "--tail", "bad", "--json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out.pop()!).error.code).toBe("WARDEN_LOG_ERROR");
  });
});

test("detect classifies a single Express package", async () => {
  await inTemp(async (root) => {
    write(
      root,
      "package.json",
      packageJson({
        dependencies: { express: "^5.1.0" },
        devDependencies: { vitest: "^3" },
        engines: { node: ">=20" },
      }),
    );
    write(root, "tsconfig.json", "{}");
    write(root, "eslint.config.js", "export default []\n");
    write(root, "package-lock.json", "{}");
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(0);
    const manifest = JSON.parse(state.out[0]!);
    expect(manifest.topology.kind).toBe("single");
    expect(manifest.packageManager.name).toBe("npm");
    expect(manifest.packages[0]).toMatchObject({
      path: ".",
      framework: "Express 5",
      role: "service",
    });
    expect(manifest.packages[0].tooling).toEqual(["ts", "vitest", "eslint"]);
    expect(manifest.packages[0].evidence.length).toBeGreaterThan(3);
    expect(await runWarden(["detect"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("single package · npm · node >=20 · 1 package");
    expect(await runWarden(["detect", "--help"], state.deps)).toBe(0);
  });
});

test("detect classifies a turbo workspace with app, service, and library", async () => {
  await inTemp(async (root) => {
    write(
      root,
      "package.json",
      packageJson({ workspaces: ["apps/*", "packages/*"], packageManager: "pnpm@9.4.0" }),
    );
    write(root, "turbo.json", "{}");
    write(root, "pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    write(
      root,
      "apps/web/package.json",
      packageJson({ dependencies: { next: "15.2.0" }, devDependencies: { vitest: "3.0.0" } }),
    );
    write(root, "apps/web/next.config.ts", "export default {}\n");
    write(root, "apps/web/tsconfig.json", "{}");
    write(root, "apps/web/biome.json", "{}");
    write(
      root,
      "apps/api/package.json",
      packageJson({ dependencies: { express: "5.0.0" }, devDependencies: { jest: "29" } }),
    );
    write(root, "apps/api/tsconfig.json", "{}");
    write(root, "packages/shared/package.json", packageJson({ name: "shared" }));
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(0);
    const manifest = JSON.parse(state.out[0]!);
    expect(manifest.topology).toMatchObject({ kind: "monorepo", orchestrator: "turbo" });
    expect(manifest.packageManager).toMatchObject({ name: "pnpm", version: "9.4.0" });
    expect(manifest.packages.map((item: { role: string }) => item.role)).toEqual([
      "service",
      "app",
      "library",
    ]);
    expect(manifest.packages[1].framework).toBe("Next.js 15");
  });
});

test("detect reads pnpm workspace patterns and reports broken package JSON", async () => {
  await inTemp(async (root) => {
    write(root, "package.json", packageJson({}));
    write(root, "pnpm-workspace.yaml", "packages:\n  - services/*\n");
    write(root, "pnpm-lock.yaml", "");
    write(
      root,
      "services/api/package.json",
      packageJson({ dependencies: { fastify: "^5" }, scripts: { test: "bun test" } }),
    );
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(0);
    const manifest = JSON.parse(state.out[0]!);
    expect(manifest.topology.orchestrator).toBe("pnpm");
    expect(manifest.packages[0]).toMatchObject({ framework: "Fastify 5", role: "service" });
    expect(manifest.packages[0].tooling).toContain("bun test");
  });
  await inTemp(async (root) => {
    write(root, "package.json", "{");
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error.code).toBe("WARDEN_DETECT_ERROR");
  });
});

test("detect covers the remaining framework and topology evidence", async () => {
  await inTemp(async (root) => {
    write(root, "package.json", packageJson({ workspaces: ["modules/*"] }));
    write(root, "nx.json", "{}");
    write(root, ".nvmrc", "22\n");
    const packages = [
      ["nest", { dependencies: { "@nestjs/core": "^11" } }, "Nest 11"],
      ["remix", { dependencies: { "@remix-run/node": "^2" } }, "Remix"],
      ["astro", { dependencies: { astro: "^5" } }, "Astro 5"],
      ["vite", { dependencies: { vite: "^6", react: "^19" } }, "Vite React"],
      ["cli", { bin: { tool: "bin.js" } }, "CLI"],
    ] as const;
    for (const [name, pkg] of packages)
      write(root, `modules/${name}/package.json`, packageJson(pkg));
    write(root, "modules/remix/remix.config.js", "export default {}\n");
    write(root, "modules/astro/astro.config.mjs", "export default {}\n");
    write(root, "modules/vite/vite.config.ts", "export default {}\n");
    write(root, "modules/cli/.prettierrc", "{}");
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(0);
    const manifest = JSON.parse(state.out[0]!);
    expect(manifest.topology).toMatchObject({ orchestrator: "nx", runtime: "node 22" });
    expect(manifest.packages.map((item: { framework: string }) => item.framework).sort()).toEqual(
      packages.map((item) => item[2]).sort(),
    );
    expect(manifest.packages.find((item: { path: string }) => item.path.endsWith("cli")).role).toBe(
      "tooling",
    );
  });
  await inTemp(async (root) => {
    write(root, "package.json", packageJson({}));
    write(root, "lerna.json", packageJson({ packages: ["libs/*"] }));
    write(root, "libs/one/package.json", packageJson({}));
    const state = makeDeps(root);
    expect(await runWarden(["detect", "--json"], state.deps)).toBe(0);
    expect(JSON.parse(state.out[0]!).topology.orchestrator).toBe("lerna");
  });
});

test("init writes accepted files, reruns idempotently, and reports errors", async () => {
  await inTemp(async (root) => {
    write(root, "package.json", packageJson({}));
    write(root, "CLAUDE.md", "# Context\n");
    write(root, "AGENTS.md", "# Instructions\n");
    write(root, ".gitignore", "node_modules/\n");
    const answers = ["yes", "y", "y", "y", "y"];
    const state = makeDeps(root, { isTTY: () => true, prompt: async () => answers.shift() ?? "n" });
    expect(await runWarden(["init"], state.deps)).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "warden.config.json"), "utf8"))).toMatchObject({
      mode: "brief",
      policies: {},
      ci: { reporters: ["summary"], failOn: "block" },
    });
    expect(readFileSync(join(root, ".github/workflows/warden.yml"), "utf8")).toContain(
      "./dist/warden ci --reporter github",
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("warden ci --reporter agent");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("node_modules/\n.warden/\n");
    const before = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(await runWarden(["init", "--yes"], state.deps)).toBe(0);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(before);
    expect(state.err.join("")).toContain("skipped: warden.config.json");
    expect(await runWarden(["init", "--help"], state.deps)).toBe(0);
  });
  await inTemp(async (root) => {
    write(root, "package.json", "bad");
    const state = makeDeps(root);
    expect(await runWarden(["init", "--json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error.code).toBe("WARDEN_INIT_ERROR");
  });
});

test("init --yes writes defaults while non-TTY mode accepts no offers", async () => {
  await inTemp(async (root) => {
    write(root, "package.json", packageJson({}));
    const state = makeDeps(root);
    expect(await runWarden(["init"], state.deps)).toBe(0);
    expect(existsSync(join(root, "warden.config.json"))).toBe(false);
    expect(state.err.join("")).toContain("wrote: nothing");
    expect(await runWarden(["init", "--yes"], state.deps)).toBe(0);
    expect(existsSync(join(root, "warden.config.json"))).toBe(true);
    expect(existsSync(join(root, ".github/workflows/warden.yml"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".warden/\n");
  });
});

function git(root: string, args: string[]) {
  const result = spawnGit(args, root);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

function gitRepo(root: string, initial: object) {
  git(root, ["init", "-b", "main"]);
  write(root, "package.json", packageJson(initial));
  git(root, ["add", "package.json"]);
  git(root, [
    "-c",
    "user.name=Warden Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-m",
    "base",
  ]);
}

test("ci handles added, bumped, and removed dependencies through every reporter", async () => {
  await inTemp(async (root) => {
    gitRepo(root, { dependencies: { keep: "1.0.0", bump: "1.0.0", remove: "1.0.0" } });
    write(
      root,
      "package.json",
      packageJson({ dependencies: { keep: "1.0.0", bump: "2.0.0", add: "1.0.0" } }),
    );
    const checked: string[] = [];
    const state = makeDeps(root, {
      check: async (spec) => {
        checked.push(spec);
        return verdict(spec, spec.startsWith("bump@") ? "block" : "warn");
      },
    });
    expect(await runWarden(["ci", "--base", "main"], state.deps)).toBe(20);
    expect(checked.sort()).toEqual(["add@1.0.0", "bump@2.0.0"]);
    expect(state.err.join("")).toContain("Warden CI · diff vs merge-base");
    expect(state.err.join("")).not.toContain("remove@");
    expect(await runWarden(["ci", "--reporter", "json"], state.deps)).toBe(20);
    const findings = JSON.parse(state.out.pop()!);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      rule: expect.any(String),
      file: "package.json",
      fix: expect.any(String),
      verify: "warden ci --reporter agent",
    });
    expect(await runWarden(["ci", "--reporter", "github"], state.deps)).toBe(20);
    expect(state.out.join("")).toContain("::error file=package.json");
    expect(await runWarden(["ci", "--reporter", "agent"], state.deps)).toBe(20);
    expect(JSON.parse(state.out.pop()!)).toMatchObject({ verdict: "block", exit: 20 });
    expect(
      JSON.parse(readFileSync(join(root, ".warden/last-run.json"), "utf8")).findings,
    ).toHaveLength(2);
    expect(await runWarden(["ci", "--help"], state.deps)).toBe(0);
  });
});

test("ci has a no-change fast path, honors failOn warn, and envelopes git errors", async () => {
  await inTemp(async (root) => {
    gitRepo(root, { dependencies: { keep: "1.0.0" } });
    let checks = 0;
    const state = makeDeps(root, {
      check: async (spec) => {
        checks++;
        return verdict(spec);
      },
    });
    expect(await runWarden(["ci", "--reporter", "json"], state.deps)).toBe(0);
    expect(JSON.parse(state.out[0]!)).toEqual([]);
    expect(checks).toBe(0);
  });
  await inTemp(async (root) => {
    gitRepo(root, { dependencies: {} });
    write(root, "package.json", packageJson({ dependencies: { caution: "1.0.0" } }));
    const warning = makeDeps(root, { check: async (spec) => verdict(spec, "warn") });
    expect(await runWarden(["ci", "--reporter=json"], warning.deps)).toBe(10);
    expect(JSON.parse(warning.out[0]!)[0].level).toBe("warn");
    write(root, "warden.config.json", packageJson({ ci: { failOn: "warn" } }));
    const state = makeDeps(root, { check: async (spec) => verdict(spec, "warn") });
    expect(await runWarden(["ci", "--reporter", "json"], state.deps)).toBe(20);
    expect(JSON.parse(state.out[0]!)[0].level).toBe("block");
  });
  await inTemp(async (root) => {
    const state = makeDeps(root, {
      git: () => ({ exitCode: 127, stdout: "", stderr: "git missing" }),
    });
    expect(await runWarden(["ci", "--reporter", "json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error).toMatchObject({
      kind: "analysis",
      code: "WARDEN_CI_ERROR",
    });
  });
  await inTemp(async (root) => {
    gitRepo(root, {});
    const state = makeDeps(root);
    expect(await runWarden(["ci", "--base", "missing", "--reporter", "json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error.reason).toContain("missing");
    expect(await runWarden(["ci", "--reporter", "invalid"], state.deps)).toBe(30);
    expect(state.err.join("")).toContain("invalid reporter");
  });
});

test("fix writes a handoff, selects the configured adapter, and handles empty or bad state", async () => {
  await inTemp(async (root) => {
    const state = makeDeps(root);
    expect(await runWarden(["fix"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("no prior failing CI run");
    write(
      root,
      ".warden/last-run.json",
      packageJson({
        findings: [
          {
            schema_version: 1,
            rule: "typosquat",
            package: "expres@0.0.5",
            file: "package.json",
            line: 2,
            level: "block",
            evidence: "one edit from express",
            fix: "replace it",
            verify: "warden ci --reporter agent",
            seen_before: false,
          },
        ],
      }),
    );
    write(state.deps.home, ".warden/config.json", packageJson({ agent: { name: "codex" } }));
    state.err.length = 0;
    expect(await runWarden(["fix"], state.deps)).toBe(0);
    const bundle = JSON.parse(readFileSync(join(root, ".warden/handoff.json"), "utf8"));
    expect(bundle).toMatchObject({
      task: "Resolve a dependency finding",
      verify: "warden ci --reporter agent",
    });
    expect(bundle.finding.evidence).toEqual(["one edit from express"]);
    expect(state.err.join("")).toContain("launch: codex exec");
    expect(await runWarden(["fix", "--help"], state.deps)).toBe(0);
  });
  await inTemp(async (root) => {
    write(root, ".warden/last-run.json", packageJson({ findings: [] }));
    const state = makeDeps(root);
    expect(await runWarden(["fix"], state.deps)).toBe(0);
    expect(state.err.join("")).toContain("no prior failing CI run");
  });
  await inTemp(async (root) => {
    write(root, ".warden/last-run.json", "bad");
    const state = makeDeps(root);
    expect(await runWarden(["fix", "--json"], state.deps)).toBe(30);
    expect(JSON.parse(state.out[0]!).error.code).toBe("WARDEN_FIX_ERROR");
  });
});
