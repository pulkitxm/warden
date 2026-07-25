import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { EXIT } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";

export interface DetectionPackage {
  path: string;
  framework: string;
  role: "app" | "service" | "library" | "tooling";
  tooling: string[];
  evidence: string[];
}

export interface DetectionManifest {
  topology: {
    kind: "single" | "monorepo";
    orchestrator: "turbo" | "nx" | "pnpm" | "lerna" | "workspaces" | null;
    runtime: string;
    evidence: string[];
  };
  packageManager: { name: string; version?: string; evidence: string[] };
  packages: DetectionPackage[];
}

export interface PackageJson {
  name?: string;
  bin?: string | Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function jsonFile<T>(deps: WardenDeps, path: string): T {
  try {
    return JSON.parse(deps.readFile(path)) as T;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function packageVersion(name: string, deps: Record<string, string>): string {
  const major = deps[name]?.match(/\d+/)?.[0];
  return major ? ` ${major}` : "";
}

function workspacePatterns(rootPackage: PackageJson, deps: WardenDeps, root: string): string[] {
  const configured = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : (rootPackage.workspaces?.packages ?? []);
  if (configured.length) return configured;
  const pnpmPath = join(root, "pnpm-workspace.yaml");
  if (deps.exists(pnpmPath)) {
    return deps
      .readFile(pnpmPath)
      .split("\n")
      .map((line) => line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/)?.[1]?.trim())
      .filter((value): value is string => Boolean(value));
  }
  const lernaPath = join(root, "lerna.json");
  if (deps.exists(lernaPath))
    return jsonFile<{ packages?: string[] }>(deps, lernaPath).packages ?? [];
  return [];
}

function classifyPackage(deps: WardenDeps, root: string, path: string): DetectionPackage {
  const directory = path === "." ? root : join(root, path);
  const packagePath = join(directory, "package.json");
  const pkg = jsonFile<PackageJson>(deps, packagePath);
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  const evidence: string[] = [];
  const has = (file: string) => deps.exists(join(directory, file));
  const config = (names: string[]) => names.find(has);
  let framework = "library";
  let role: DetectionPackage["role"] = "library";
  const nextConfig = config(["next.config.ts", "next.config.js", "next.config.mjs"]);
  const remixConfig = config(["remix.config.ts", "remix.config.js"]);
  const astroConfig = config(["astro.config.ts", "astro.config.js", "astro.config.mjs"]);
  const viteConfig = config(["vite.config.ts", "vite.config.js", "vite.config.mjs"]);
  if (all.next && nextConfig) {
    framework = `Next.js${packageVersion("next", all)}`;
    role = "app";
    evidence.push(`next in dependencies, ${nextConfig}`);
  } else if (all.express) {
    framework = `Express${packageVersion("express", all)}`;
    role = "service";
    evidence.push("express in dependencies");
  } else if (all.fastify) {
    framework = `Fastify${packageVersion("fastify", all)}`;
    role = "service";
    evidence.push("fastify in dependencies");
  } else if (all["@nestjs/core"]) {
    framework = `Nest${packageVersion("@nestjs/core", all)}`;
    role = "service";
    evidence.push("@nestjs/core in dependencies");
  } else if ((all["@remix-run/node"] || all["@remix-run/react"] || all.remix) && remixConfig) {
    framework = "Remix";
    role = "app";
    evidence.push(`@remix-run dependency, ${remixConfig}`);
  } else if (all.astro && astroConfig) {
    framework = `Astro${packageVersion("astro", all)}`;
    role = "app";
    evidence.push(`astro in dependencies, ${astroConfig}`);
  } else if (all.vite && all.react && viteConfig) {
    framework = "Vite React";
    role = "app";
    evidence.push(`vite and react in dependencies, ${viteConfig}`);
  } else if (pkg.bin) {
    framework = "CLI";
    role = "tooling";
    evidence.push("bin in package.json");
  } else {
    evidence.push("package.json has no bin or framework dependency");
  }
  const tooling: string[] = [];
  if (has("tsconfig.json")) {
    tooling.push("ts");
    evidence.push("tsconfig.json");
  } else {
    tooling.push("js");
    evidence.push("package.json without tsconfig.json");
  }
  if (all.vitest) {
    tooling.push("vitest");
    evidence.push("vitest in devDependencies");
  } else if (all.jest) {
    tooling.push("jest");
    evidence.push("jest in devDependencies");
  } else if (Object.values(pkg.scripts ?? {}).some((script) => /\bbun test\b/.test(script))) {
    tooling.push("bun test");
    evidence.push("bun test in package.json scripts");
  } else {
    tooling.push("no test runner");
    evidence.push("package.json has no test runner dependency or script");
  }
  const formatterFiles: [string[], string][] = [
    [["biome.json", "biome.jsonc"], "biome"],
    [["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.json"], "eslint"],
    [[".prettierrc", ".prettierrc.json", "prettier.config.js", "prettier.config.mjs"], "prettier"],
  ];
  for (const [files, name] of formatterFiles) {
    const found = config(files);
    if (found) {
      tooling.push(name);
      evidence.push(found);
    }
  }
  return { path, framework, role, tooling, evidence };
}

export function detectWorkspace(deps: WardenDeps): DetectionManifest {
  const root = deps.cwd();
  const rootPackagePath = join(root, "package.json");
  const rootPackage = jsonFile<PackageJson>(deps, rootPackagePath);
  const topologyCandidates: [string, DetectionManifest["topology"]["orchestrator"]][] = [
    ["turbo.json", "turbo"],
    ["nx.json", "nx"],
    ["pnpm-workspace.yaml", "pnpm"],
    ["lerna.json", "lerna"],
  ];
  const topologyFiles = topologyCandidates.filter(([file]) => deps.exists(join(root, file)));
  const patterns = workspacePatterns(rootPackage, deps, root);
  const orchestrator = topologyFiles[0]?.[1] ?? (patterns.length ? "workspaces" : null);
  const topologyEvidence = topologyFiles.map(([file]) => file);
  if (patterns.length)
    topologyEvidence.push(
      rootPackage.workspaces ? "package.json workspaces" : "workspace package patterns",
    );
  if (!topologyEvidence.length) topologyEvidence.push("package.json single package");
  const memberPaths = patterns.length
    ? [
        ...new Set(
          patterns
            .flatMap((pattern) => deps.glob(`${pattern.replace(/\/$/, "")}/package.json`, root))
            .map(dirname),
        ),
      ]
    : ["."];
  const normalizedPaths = memberPaths.map((path) => {
    const value = path.startsWith(root) ? relative(root, path) : path;
    return value || ".";
  });
  const managerField = rootPackage.packageManager?.match(/^([^@]+)@(.+)$/);
  const lockfiles: [string, string][] = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];
  const lock = lockfiles.find(([file]) => deps.exists(join(root, file)));
  const manager = managerField?.[1] ?? lock?.[1] ?? "npm";
  const managerEvidence = rootPackage.packageManager
    ? ["packageManager in package.json"]
    : lock
      ? [lock[0]]
      : ["package.json without a lockfile"];
  const nvmPath = join(root, ".nvmrc");
  const runtime = rootPackage.engines?.node
    ? `node ${rootPackage.engines.node}`
    : deps.exists(nvmPath)
      ? `node ${deps.readFile(nvmPath).trim()}`
      : "node unspecified";
  topologyEvidence.push(
    rootPackage.engines?.node
      ? "engines.node in package.json"
      : deps.exists(nvmPath)
        ? ".nvmrc"
        : "package.json without node engine",
  );
  return {
    topology: {
      kind: patterns.length ? "monorepo" : "single",
      orchestrator,
      runtime,
      evidence: topologyEvidence,
    },
    packageManager: {
      name: manager,
      ...(managerField?.[2] ? { version: managerField[2] } : {}),
      evidence: managerEvidence,
    },
    packages: normalizedPaths.sort().map((path) => classifyPackage(deps, root, path)),
  };
}

export function renderDetection(manifest: DetectionManifest): string {
  const manager = `${manifest.packageManager.name}${manifest.packageManager.version ? `@${manifest.packageManager.version}` : ""}`;
  const heading =
    manifest.topology.kind === "single"
      ? "single package"
      : `${manifest.topology.orchestrator} monorepo`;
  const rows = manifest.packages
    .map(
      (pkg) =>
        `  ${pkg.path.padEnd(20)} ${pkg.framework.padEnd(14)} ${pkg.role.padEnd(9)} ${pkg.tooling.join(", ")}`,
    )
    .join("\n");
  const evidence = manifest.packages
    .map((pkg) => `  ${pkg.path.padEnd(12)} ${pkg.evidence.join(", ")}`)
    .join("\n");
  return `${heading} · ${manager} · ${manifest.topology.runtime} · ${manifest.packages.length} package${manifest.packages.length === 1 ? "" : "s"}\n\n${rows}\n\nevidence:\n  topology     ${manifest.topology.evidence.join(", ")}\n${evidence}\n`;
}

export function runWardenDetect(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  try {
    parseArgs({ args: argv, options: { json: { type: "boolean" } } });
    const manifest = detectWorkspace(deps);
    if (wantsJson) deps.stdout(`${JSON.stringify(manifest)}\n`);
    else deps.stderr(renderDetection(manifest));
    return EXIT.allow;
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_DETECT_ERROR",
      (error as Error).message,
      "fix the unreadable package.json and retry",
    );
  }
}
