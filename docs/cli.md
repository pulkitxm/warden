# CLI

## `wnpm install [packages...] [--json] [--allow-risky]`

Checks explicit packages, or direct dependencies from `package.json` when none are given. A block stops installation unless `--allow-risky` is present. Cleared packages install through pnpm, Bun, or npm with lifecycle scripts disabled where supported.

## `wnpx <package[@version]> [--json] [--allow-risky]`

Checks one package intended for execution. Human output goes to stderr. `--json` writes exactly one verdict object to stdout. WNPM currently reports what would execute but does not run `npx` itself.

## `wnpx --schema`

Prints the verdict JSON Schema.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | allow |
| 10 | warn |
| 20 | block |
| 30 | analysis error |
