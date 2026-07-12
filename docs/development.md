# Development

## Toolchain

Bun is the runtime and toolchain — one tool for tests, the dev runner, and the
lockfile (`bun.lock`). TypeScript's `tsc` does two jobs Bun doesn't: type
checking and emitting the Node-compatible `dist/` (users run the CLIs with
plain Node; CI smoke-tests exactly that). Biome handles linting and
formatting.

```sh
bun install               # deps (bun.lock)
bun run dev               # run the CLI from source (bun src/cli/index.ts)
bun test                  # tests + coverage, 100% threshold ENFORCED
bun run typecheck         # tsc --noEmit
bun run build             # tsc -> dist/ (Node-compatible, with d.ts)
bun run lint              # biome ci (lint + format check)
bun run format            # biome format --write
bun run strip-comments    # remove code comments (CI enforces --check)
```

## Tests and the 100% gate

`bunfig.toml` sets `coverage = true` and `coverageThreshold = 1.0`, so every
`bun test` run fails below **100% line and function coverage** on all loaded
`src/` files. The suite is fully offline:

- `test/helpers/fetchStub.ts` — route-based global-`fetch` stub (registry,
  downloads, OSV, deps.dev, Anthropic responses).
- `test/helpers/tar.ts` — in-memory ustar+gzip writer for real tarball bytes.
- CLI commands are tested through `run(argv, deps)` with injected
  `spawn`/`readInput`/`readPackageJson` — no process spawns, no `process.exit`.
- The bin entry shims (`src/cli/index.ts`, `bnpm.ts`, `bnpx.ts`, `bin.ts`) are
  the only untested files: they are 3–5 lines of `run + process.exit`, never
  imported by tests, and exercised instead by the CI smoke test
  (`node dist/cli/index.js --help`).

Bun quirk worth knowing: function coverage counts a class's *synthesized*
constructor as a never-called function. Any class in `src/` therefore has an
explicit constructor (or is an object literal). If a new file mysteriously
fails the gate at 100% lines, check for that first.

## No-comments policy

The codebase contains no code comments (functional directives like
`@ts-expect-error` and `biome-ignore` are exempt). `scripts/strip-comments.mjs`
removes them (`bun run strip-comments`) and CI runs `--check` plus the
script's `--selftest`. It parses TS/JS with the TypeScript compiler API (so
`typescript` stays a dependency even under Bun) and also handles JSON(C),
YAML, HTML, and CSS. Write code that explains itself; put rationale in docs or
commit messages.

## CI

`.github/workflows/ci.yml` — on PRs and pushes to `main`, with per-ref
concurrency cancellation, four parallel jobs:

1. **comments** — stripper `--selftest` + `--check`.
2. **lint** — `biome ci`.
3. **test** — `bun test --coverage` (100% threshold).
4. **typecheck-build** — `tsc --noEmit`, `tsc` build, then Node smoke tests of
   the built CLI (`--help`, `help`, and a `hook` round-trip).

## Conventions

- Folders are lowercase (`task-tracker/`, `docs/`, `adapters/`); conventional
  uppercase filenames (`README.md`, `LICENSE`, `SKILL.md`) are the exception.
- The nested [`wnpm/`](../wnpm/) monorepo is a separate git repository with
  its own toolchain and CI story; nothing in this package imports from it.
- Test files mirror `src/` module names (`test/registry.test.ts` covers
  `src/registry.ts`); shared fixtures live in `test/fixtures.ts` and
  `test/helpers/`.
