import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { EXIT } from "../../schema.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";
import { detectWorkspace, renderDetection } from "./detect.ts";

async function accepted(deps: WardenDeps, yes: boolean, question: string): Promise<boolean> {
  if (yes) return true;
  if (!deps.isTTY()) return false;
  return /^y(?:es)?$/i.test((await deps.prompt(`${question} [y/N] `)).trim());
}

export async function runWardenInit(argv: string[], deps: WardenDeps): Promise<number> {
  const wantsJson = argv.includes("--json");
  try {
    const { values } = parseArgs({
      args: argv,
      options: { yes: { type: "boolean" }, json: { type: "boolean" } },
    });
    const manifest = detectWorkspace(deps);
    deps.stderr(renderDetection(manifest));
    const root = deps.cwd();
    const changes: [string, string, string][] = [
      [
        "warden.config.json",
        `${JSON.stringify({ $schema: "https://raw.githubusercontent.com/pulkitxm/warden/main/schema/warden.config.json", mode: "brief", policies: {}, ci: { reporters: ["summary"], failOn: "block" } }, null, 2)}\n`,
        "write warden.config.json",
      ],
      [
        ".github/workflows/warden.yml",
        "name: Warden\non:\n  pull_request:\njobs:\n  warden:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n      - run: bun run build\n      - run: ./dist/warden ci --reporter github\n",
        "write .github/workflows/warden.yml",
      ],
    ];
    const section =
      "\n## Warden\n\nWarden enforces dependency trust and repository policy.\nRun `warden ci --reporter agent` for actionable feedback.\n";
    for (const context of ["CLAUDE.md", "AGENTS.md"]) {
      const path = join(root, context);
      if (deps.exists(path))
        changes.push([
          context,
          `${deps.readFile(path).trimEnd()}${section}`,
          `append Warden guidance to ${context}`,
        ]);
    }
    const gitignorePath = join(root, ".gitignore");
    changes.push([
      ".gitignore",
      deps.exists(gitignorePath)
        ? `${deps.readFile(gitignorePath).trimEnd()}\n.warden/\n`
        : ".warden/\n",
      "ignore .warden/ in .gitignore",
    ]);
    const idempotentMarker: Record<string, string> = {
      "CLAUDE.md": "## Warden",
      "AGENTS.md": "## Warden",
      ".gitignore": ".warden/",
    };
    const written: string[] = [];
    const skipped: string[] = [];
    for (const [file, content, question] of changes) {
      const path = join(root, file);
      const marker = idempotentMarker[file];
      if (deps.exists(path) && (marker === undefined || deps.readFile(path).includes(marker))) {
        skipped.push(file);
        continue;
      }
      if (!(await accepted(deps, Boolean(values.yes), question))) {
        skipped.push(file);
        continue;
      }
      deps.mkdir(dirname(path));
      deps.writeFile(path, content);
      written.push(file);
    }
    deps.stderr(
      `wrote: ${written.length ? written.join(", ") : "nothing"}\nskipped: ${skipped.length ? skipped.join(", ") : "nothing"}\n`,
    );
    return EXIT.allow;
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "analysis",
      "WARDEN_INIT_ERROR",
      (error as Error).message,
      "fix workspace files and retry warden init",
    );
  }
}
