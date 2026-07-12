# Prompt: Code standards pass for Warden

We've made a lot of changes today in the Warden codebase (`/home/manas/projects/npm`). Please do the following, using sub-agents to fan out over the work:

1. **Review today's changes.** Go through everything in the repo using sub-agents — the root `src/` package (engine, registry, diff, cache, enrich, verdict, heuristics, CLI entrypoints `warden`/`bnpm`/`bnpx`, `adapters/parseCommand`), the `adapters/claude-code` skill, and the nested `warden/` sub-project. Everything is currently untracked on the `build-warden-mvp` branch, so treat the whole tree as the diff to review.

2. **Testing to 100% coverage.** We currently only have `test/heuristics.test.ts`, `test/parseCommand.test.ts`, and `test/diff.test.ts`. Generate tests covering every module in `src/` — engine orchestration, registry fetching (mocked, no live npm calls), tarball diffing, the obfuscation/nameDistance/scriptScan heuristics, cache, enrich, verdict scoring, and the CLI render/argument parsing — until coverage is 100%. Enable and enforce a coverage threshold in the test config.

3. **Migrate to Bun as the runtime and toolchain.** We want Bun to replace as many separate tools as possible so we aren't maintaining 10 different packages: use `bun test` instead of vitest, `bun` instead of `tsx` for running TS directly (the `warden` dev script), Bun's bundler/`bun build` where it fits, and `bun.lock` instead of `pnpm-lock.yaml`. The nested `warden/` sub-project already uses Bun — align the root package with it. Keep `tsc --noEmit` for type checking. Drop dev dependencies Bun makes redundant.

4. **Add Biome** for formatting and linting, with `lint` and `format` scripts in `package.json`.

5. **Clean up structure.** Modularize and remove duplication — in particular, `bnpm.ts` and `bnpx.ts` likely share wrapper logic, and the root `src/` and nested `warden/` sub-project may duplicate concepts. Group shared helpers into a `utils/` (or similar) module rather than repeating them. Keep folders grouped by responsibility as they are now (`heuristics/`, `cli/`, `cache/`, etc.).

6. **No code comments.** The codebase must contain no comments of any type (functional directives like `@ts-expect-error` and `biome-ignore` are exempt). Add the comment-stripper script below as `scripts/strip-comments.mjs` with a `strip-comments` script in `package.json`, and wire its `--check` mode into CI. Note it uses the `typescript` package's parser, so keep `typescript` as a dependency even after the Bun migration.

7. **GitHub Actions CI.** Add a workflow that runs on PRs and pushes to `main` with concurrency cancellation, using `oven-sh/setup-bun` and `bun install --frozen-lockfile`, with jobs for:
   - the comment-stripper self-test (`--selftest`) and check (`--check`),
   - Biome lint/format check,
   - `bun test` with the coverage threshold enforced,
   - `tsc --noEmit` type check,
   - the `build` script, plus a smoke test that the produced `dist/` CLI binaries actually run (e.g. `node dist/cli/index.js --help`).

   There is an existing CI workflow from another project below as a reference for shape — improve on it rather than copying it; the Swift and promo-video jobs don't apply here.

## Comment-stripper script (add as `scripts/strip-comments.mjs`)

```js
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const args = process.argv.slice(2);
const CHECK = args.some(
  (a) => a === "--check" || a === "--dry-run" || a === "--dry",
);
const SELFTEST = args.includes("--selftest");

export function keep(raw) {
  const isLine = raw.startsWith("//");
  if (
    isLine &&
    raw.startsWith("///") &&
    /^<(reference|amd-)/.test(raw.slice(3).trim())
  ) {
    return true;
  }
  if (!isLine && raw.startsWith("/*!")) return true;
  const inner = isLine ? raw.replace(/^\/\/+/, "") : raw.slice(2, -2);
  const t = inner.trim().replace(/^\*+\s*/, "");

  if (/^@(ts-ignore|ts-expect-error|ts-nocheck|ts-check)\b/.test(t))
    return true;
  if (/^eslint-(disable|enable)(-next-line|-line)?\b/.test(t)) return true;
  if (/^biome-ignore\b/.test(t)) return true;
  if (/^prettier-ignore\b/.test(t)) return true;
  if (/^@(jsx|jsxImportSource|jsxRuntime|jsxFrag)\b/.test(t)) return true;
  if (/^#\s*source(MappingURL|URL)\b/.test(t)) return true;
  if (/^@vite-ignore\b/.test(t)) return true;
  if (/^[#@]__(PURE|NO_SIDE_EFFECTS)__/.test(t)) return true;
  if (/^(istanbul|c8|v8)\s+ignore\b/.test(t)) return true;
  if (/^@(license|preserve)\b/.test(t)) return true;
  if (/webpack(ChunkName|Mode|Prefetch|Preload|Include|Exclude|Ignore)/.test(t))
    return true;

  if (!isLine && /^(eslint-env|eslint\s|globals?\s|exported\b)/.test(t))
    return true;

  return false;
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(c|m)?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export function tsComments(file, text) {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const seen = new Set();
  const found = [];
  const jsxSpans = [];
  const add = (ranges) => {
    for (const r of ranges || []) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ pos: r.pos, end: r.end });
    }
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxSpans.push([node.getFullStart(), node.getEnd()]);
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.getFullStart()));
      add(ts.getTrailingCommentRanges(text, node.getEnd()));
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);

  const inJsxText = (r) => jsxSpans.some(([s, e]) => r.pos < e && r.end > s);
  const remove = [];
  let kept = 0;
  for (const r of found) {
    if (inJsxText(r)) continue;
    if (keep(text.slice(r.pos, r.end))) kept++;
    else remove.push(r);
  }
  return { remove, kept };
}

export function htmlComments(text) {
  const remove = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("<!--", i)) {
      const start = i;
      let j = i + 4;
      while (j < n && !text.startsWith("-->", j)) j++;
      const end = Math.min(n, j + 3);
      remove.push({ pos: start, end });
      i = end;
      continue;
    }
    i++;
  }
  return { remove, kept: 0 };
}

export function cssComments(text) {
  const remove = [];
  let kept = 0;
  let i = 0;
  const n = text.length;
  let str = null;
  while (i < n) {
    const c = text[i];
    if (str) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const start = i;
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      const end = Math.min(n, j + 2);
      if (text.slice(start, end).startsWith("/*!")) kept++;
      else remove.push({ pos: start, end });
      i = end;
      continue;
    }
    i++;
  }
  return { remove, kept };
}

export function jsoncComments(text) {
  const remove = [];
  let i = 0;
  const n = text.length;
  let str = false;
  while (i < n) {
    const c = text[i];
    if (str) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') {
      str = true;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const start = i;
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      const end = Math.min(n, j + 2);
      remove.push({ pos: start, end });
      i = end;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const start = i;
      let j = i + 2;
      while (j < n && text[j] !== "\n") j++;
      remove.push({ pos: start, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return { remove, kept: 0 };
}

function keepYaml(t) {
  if (/^yaml-language-server\b/.test(t)) return true;
  if (/^yamllint\b/.test(t)) return true;
  return false;
}

export function yamlComments(text) {
  const remove = [];
  let kept = 0;
  const lines = text.split("\n");
  let pos = 0;
  let blockIndent = null;
  let str = null;
  for (const line of lines) {
    const lineStart = pos;
    pos += line.length + 1;
    const firstNonWs = line.search(/\S/);
    const isBlank = firstNonWs === -1;
    const indent = isBlank ? 0 : firstNonWs;
    if (str === null && blockIndent !== null) {
      if (isBlank || indent > blockIndent) continue;
      blockIndent = null;
    }
    if (str === null && isBlank) continue;
    let commentAt = -1;
    let prevWs = true;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (str === '"') {
        if (c === "\\") {
          k++;
          prevWs = false;
          continue;
        }
        if (c === '"') str = null;
        prevWs = false;
        continue;
      }
      if (str === "'") {
        if (c === "'" && line[k + 1] === "'") {
          k++;
          prevWs = false;
          continue;
        }
        if (c === "'") str = null;
        prevWs = false;
        continue;
      }
      if (c === '"' || c === "'") {
        str = c;
        prevWs = false;
        continue;
      }
      if (c === "#" && prevWs) {
        commentAt = k;
        break;
      }
      prevWs = c === " " || c === "\t";
    }
    if (str === null) {
      const code = (
        commentAt === -1 ? line : line.slice(0, commentAt)
      ).trimEnd();
      if (/(?:^|\s)[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(code))
        blockIndent = indent;
    }
    if (commentAt === -1) continue;
    const inner = line.slice(commentAt + 1).trim();
    if (keepYaml(inner)) {
      kept++;
      continue;
    }
    remove.push({ pos: lineStart + commentAt, end: lineStart + line.length });
  }
  return { remove, kept };
}

function expand(text, pos, end) {
  let ls = pos;
  while (ls > 0 && text[ls - 1] !== "\n") ls--;
  let le = end;
  while (le < text.length && text[le] !== "\n") le++;
  if (
    /^[ \t]*$/.test(text.slice(ls, pos)) &&
    /^[ \t]*$/.test(text.slice(end, le))
  ) {
    return { start: ls, end: le < text.length ? le + 1 : le };
  }
  return { start: pos, end };
}

export function build(text, ranges) {
  const exp = ranges.map((r) => expand(text, r.pos, r.end));
  exp.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const r of exp) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  let out = "";
  let cursor = 0;
  for (const r of merged) {
    out += text.slice(cursor, r.start);
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

function tidyText(s) {
  return s
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "\n");
}

function lineOf(text, pos) {
  let line = 1;
  for (let i = 0; i < pos; i++) if (text[i] === "\n") line++;
  return line;
}

function snippet(text, r) {
  const first = text.slice(r.pos, r.end).split("\n")[0].trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

export function scan(file, text) {
  const ext = file.slice(file.lastIndexOf("."));
  if (ext === ".html" || ext === ".htm") return htmlComments(text);
  if (ext === ".css") return cssComments(text);
  if (ext === ".json" || ext === ".jsonc") return jsoncComments(text);
  if (ext === ".yml" || ext === ".yaml") return yamlComments(text);
  return tsComments(file, text);
}

function selftest() {
  const cases = [
    {
      name: "url in string + trailing comment",
      src: 'const u = "https://x.com" // c',
      remove: 1,
      kept: 0,
    },
    {
      name: "ts-expect-error kept",
      src: "// @ts-expect-error\nconst x = 1",
      remove: 0,
      kept: 1,
    },
    {
      name: "biome-ignore kept",
      src: "// biome-ignore lint: reason\nconst x = 1",
      remove: 0,
      kept: 1,
    },
    {
      name: "block comment stripped",
      src: "/* note */ const x = 1",
      remove: 1,
      kept: 0,
    },
    {
      name: "license header kept",
      src: "/*! MIT */\nconst x = 1",
      remove: 0,
      kept: 1,
    },
    {
      name: "jsonc comment stripped",
      src: '{\n  // note\n  "a": 1\n}',
      remove: 1,
      kept: 0,
      file: "x.jsonc",
    },
    {
      name: "yaml comment stripped",
      src: "a: 1 # note",
      remove: 1,
      kept: 0,
      file: "x.yml",
    },
    {
      name: "yaml block scalar preserved",
      src: "run: |\n  echo '# not a comment'",
      remove: 0,
      kept: 0,
      file: "x.yml",
    },
  ];
  let failed = 0;
  for (const t of cases) {
    const { remove, kept } = scan(t.file ?? "x.ts", t.src);
    const ok = remove.length === t.remove && kept === t.kept;
    if (!ok) {
      failed++;
      console.error(
        `FAIL ${t.name}: got remove=${remove.length} kept=${kept}, want remove=${t.remove} kept=${t.kept}`,
      );
    }
  }
  const url = 'const u = "https://x.com" // c';
  const { remove } = tsComments("x.ts", url);
  if (!build(url, remove).startsWith('const u = "https://x.com"')) {
    failed++;
    console.error("FAIL url integrity");
  }
  if (failed) {
    console.error(`\nselftest: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log(`selftest: all ${cases.length} cases passed`);
}

function buildSummary(findings, { totalRemoved, changedFiles, totalKept }) {
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const fileCell = (f, line) => {
    if (!repo || !sha) return `\`${f}\``;
    const href = `${server}/${repo}/blob/${sha}/${f.split("/").map(encodeURIComponent).join("/")}#L${line}`;
    return `[\`${f}\`](${href})`;
  };
  const codeCell = (s) =>
    s
      .replace(/[\\|]/g, "\\$&")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const rows = findings
    .map(
      (x) =>
        `| ${fileCell(x.file, x.line)} | ${x.line} | <code>${codeCell(x.text)}</code> |`,
    )
    .join("\n");
  return [
    `## ❌ ${totalRemoved} disallowed code comment${totalRemoved === 1 ? "" : "s"}`,
    "",
    `Comments are not allowed in code - found in **${changedFiles}** file${changedFiles === 1 ? "" : "s"} (**${totalKept}** functional directive${totalKept === 1 ? "" : "s"} were ignored). Remove them locally with:`,
    "",
    "```bash",
    "bun run strip-comments",
    "```",
    "",
    "| File | Line | Comment |",
    "| --- | --- | --- |",
    rows,
    "",
  ].join("\n");
}

function reportGithub(findings, stats) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const escData = (s) =>
    s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escProp = (s) => escData(s).replace(/,/g, "%2C").replace(/:/g, "%3A");
  for (const x of findings) {
    console.log(
      `::error file=${escProp(x.file)},line=${x.line},title=Disallowed comment::${escData(x.text)}`,
    );
  }
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (!out) return;
  const md = findings.length
    ? buildSummary(findings, stats)
    : "## ✅ No disallowed code comments\n\nEvery tracked file is comment-free (functional directives ignored).\n";
  appendFileSync(out, `${md}\n`);
}

function main() {
  const files = execSync(
    "git ls-files '*.html' '*.htm' '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.css' '*.json' '*.jsonc' '*.yml' '*.yaml'",
    { encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !/(^|\/)(package-lock\.json|bun\.lock|pnpm-lock\.yaml)$/.test(f));

  let changedFiles = 0;
  let totalRemoved = 0;
  let totalKept = 0;
  const findings = [];

  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const ext = f.slice(f.lastIndexOf("."));
    const { remove, kept } = scan(f, text);
    totalKept += kept;
    if (remove.length === 0) continue;
    changedFiles++;
    totalRemoved += remove.length;
    if (CHECK) {
      for (const r of remove)
        findings.push({
          file: f,
          line: lineOf(text, r.pos),
          text: snippet(text, r),
        });
      continue;
    }
    let out = build(text, remove);
    if (ext === ".css" || ext === ".html" || ext === ".htm")
      out = tidyText(out);
    if (out !== text) writeFileSync(f, out);
  }

  if (CHECK) {
    for (const x of findings) console.log(`${x.file}:${x.line}: ${x.text}`);
    reportGithub(findings, { totalRemoved, changedFiles, totalKept });
    console.log(
      `\n${totalRemoved} disallowed comment(s) in ${changedFiles} file(s) (${totalKept} directive(s) ignored).`,
    );
    if (totalRemoved > 0) {
      console.log(
        "Code comments are not allowed. Run `bun run strip-comments` to remove them.",
      );
      process.exit(1);
    }
    console.log("OK: no disallowed comments found.");
  } else {
    console.log(`scanned ${files.length} files`);
    console.log(`changed: ${changedFiles} files`);
    console.log(`comments removed: ${totalRemoved}`);
    console.log(`directives/license kept: ${totalKept}`);
  }
}

if (import.meta.main) {
  if (SELFTEST) selftest();
  else main();
}
```

## Reference CI workflow (improve, don't copy — Swift and promo-video jobs don't apply)

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  comments:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Comment-stripper self-test
        run: bun scripts/strip-comments.mjs --selftest
      - name: No disallowed comments
        run: bun scripts/strip-comments.mjs --check

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Lint (Biome)
        run: bun run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Tests (100% coverage enforced)
        run: bun test --coverage

  typecheck-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Type-check
        run: bun run typecheck
      - name: Build
        run: bun run build
      - name: CLI smoke test
        run: node dist/cli/index.js --help
```
