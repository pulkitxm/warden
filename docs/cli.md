# CLI

## `wnpm install [packages...] [--json] [--allow-risky]`

Checks explicit packages, or direct dependencies from `package.json` when none are given. A block stops installation unless `--allow-risky` is present. Cleared packages install through pnpm, Bun, or npm with lifecycle scripts disabled where supported.

## `wnpx <package[@version]> [--json] [--allow-risky]`

Checks one package intended for execution. Human output goes to stderr. `--json` writes exactly one verdict object to stdout. WNPM currently reports what would execute but does not run `npx` itself.

## `wnpx --schema`

Prints the verdict JSON Schema.

## `wnpm doctor [--dir path] [--json] [--no-verify] [--apply]`

Audits the project's direct dependencies:

1. Reads `package.json` plus installed versions from `package-lock.json` or `node_modules`.
2. Queries OSV advisories and registry metadata for every dependency.
3. Builds a minimal and a latest upgrade plan from versions that clear every advisory.
4. Gates each candidate version through the standard verdict engine; blocked candidates are rejected with evidence.
5. Verifies each surviving plan in a throwaway workspace: install with lifecycle scripts disabled, then the project's own `test`, `typecheck`, and `build` scripts.

`--no-verify` skips step 5. `--apply` pins the recommended plan's exact verified versions into `package.json` and reinstalls. `--json` writes one report object to stdout.

Doctor exit codes: `0` when no issues remain or a fix was applied, `10` when issues remain, `30` on analysis error.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | allow |
| 10 | warn |
| 20 | block |
| 30 | analysis error |
