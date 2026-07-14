# Features

Everything warden ships today, in one place. Each section links to the detailed design where one exists.

Part of the [product plan](system-integration.md).

## Vetting engine

`warden check` runs every package through a deterministic pipeline before anything installs or executes:

1. Resolve the package and version against the npm registry.
2. Fetch the tarball and verify its integrity hash.
3. Diff the release against the previous version: new or changed install scripts, maintainer and publisher changes, provenance downgrades.
4. Scan tarball JavaScript with an AST walk (acorn), not regexes.
5. Compare the name against popular packages for typosquats, homoglyphs, and scoped impersonation, backed by a download-count popularity table.
6. Check curated intel: known-malicious versions (`intel/data/blocklist.json`) and known hallucinated names (`intel/data/hallucinated.json`).
7. Score all signals with deterministic rules into allow, warn, or block.

Newness and low downloads never block on their own. An optional OpenAI pass (`OPENAI_API_KEY`) can rewrite the human summary but can never change the verdict.

### Detection signals

- name attacks: typosquat, homoglyph, scoped impersonation, hallucinated package names
- known malicious versions via blocklist
- new or changed install scripts between versions
- maintainer, publisher email, and provenance changes
- code capabilities: eval and dynamic code construction, child_process and shell execution, network and DNS egress, raw IP literals, reverse shells
- data access: environment variable reads and dumps, sensitive file access, cloud metadata hosts, destructive filesystem calls
- obfuscation combined with execution or network capability

### Verdicts

Every check returns a versioned JSON verdict (`warden schema` prints the JSON Schema): package, version, integrity, verdict, risk score 0-100, categories, evidence with file locations, and a plain-language summary. Exit codes are stable: `0` allow, `10` warn, `20` block, `30` analysis error. `--allow-risky` deliberately overrides a block and exits `10`.

Verdicts are cached in SQLite (`~/.wnpm-cache/verdicts.sqlite`) keyed by tarball integrity and analyzer version, so repeat checks are instant and re-analysis happens automatically when the analyzer changes.

## Interception

See [interception](interception.md).

- `wnpm` and `wnpx`: drop-in commands that vet first, then delegate to the real manager. `wnpm` falls back to npm and propagates exit codes; `wnpx` vets the package a command would execute.
- Transparent shims: the installer copies `scripts/shim.sh` over `npm`, `pnpm`, `yarn`, `bun`, `npx`, and `bunx` on PATH. Install and exec commands are vetted before the real tool runs; everything else passes straight through. No habit changes required.
- Two modes: **protect** (block risky installs before any script runs) and **observe** (never block, record verdicts to `~/.warden/log.jsonl`). `warden log --tail N` renders the recorded history.
- Per-user control via `warden config`: mode, and intercept toggles for install and exec, stored in `~/.warden/config.json` ([config](config.md)).

## Dependency doctor

`wnpm doctor` turns the same trust signals into a safe repair loop for an existing project. It reads direct dependencies and their installed versions, queries OSV advisories, and makes both a minimal and a latest upgrade plan. Every candidate is checked by the normal supply-chain gate, so an advisory's nominal fix is rejected when the release itself is risky.

Before changing the project, doctor copies it to an isolated workspace, installs with lifecycle scripts disabled, and runs any present `test`, `typecheck`, and `build` scripts. By default it pins the recommended verified versions in `package.json` and reinstalls them. `wnpm doctor --no-apply` produces the report without changing the project; `--dir <path>` targets another workspace. The JSON report records issues, rejected candidates, plans, verification steps, and whether a plan was applied.

See [docs/doctor.md](doctor.md) for the full reference.

## Workspace awareness

See [detection and init](detection-and-init.md).

- `warden detect` classifies the repo without touching it: topology (single package or monorepo, orchestrator), package manager and version, and per-package framework, role (app, service, library), and tooling, all with evidence.
- `warden init` onboards a repo from that manifest: writes config, a CI workflow, hooks, and agent context files, prompting per file (`--yes` accepts everything).

## CI

`warden ci` checks only what changed: it diffs dependency manifests against the merge base (`--base <ref>` to override) and vets the additions. Reporters: `summary` for humans, `json` for machines, `github` for workflow annotations, and `agent` for coding agents. Exit codes match `check`, so a block fails the pipeline.

## Agent-first CLI

See [agent-first CLI](agent-first-cli.md).

- Structured everything: `--json` on every verb, published schemas via `warden schema`, and typed JSON error envelopes (kind, code, reason, hint) instead of free-text errors.
- `warden fix` hands the last failing check to your coding agent with full context.
- An agent skill file and offline simulation live in `demo/`.

## Shell experience

- Completions for bash, zsh, and fish, generated from the single CLI command registry so they never drift from the real flags ([autocomplete](autocomplete.md)). Wired into the shell rc by the installer.
- Consistent help: every verb has `--help`, exit-code documentation, and an example, all rendered from the same registry.

## Distribution

See [distribution](distribution.md).

- `install.sh`: detects OS and architecture, downloads the latest release, verifies sha256 checksums, installs `warden`, `wnpm`, and `wnpx` to `~/.warden/bin`, sets up shims for the managers you choose, wires PATH and completions into your shell rc, and links into `/usr/local/bin` when possible. Supports local-source installs (`WARDEN_INSTALL_SOURCE`), a clean upgrade path that preserves config, and full `--uninstall`.
- Docker workflow, so development never touches the host: `make docker-run` drops into a sandbox with warden preinstalled and interception active, the repo mounted read-only at `/work`, and a writable playground at `/play`; `make docker-install-demo` demos the installer from scratch in a fresh container.

## Development infrastructure

- One gate: `make ci` runs comment-free source enforcement, strict Biome lint and format (warnings fail), the full test suite with 100% line and function coverage, typecheck, compiled builds of all three binaries, and CLI smoke tests. A tracked pre-push hook runs the same gate before every push.
- Fully offline test registry in `fixtures/registry` (packument, tarball, and download-count endpoints), so tests and the demo run with no network.
- Benchmark suites: `scripts/vuln-suite.ts` measures detection against known-bad packages, `scripts/generalization-suite.ts` measures false positives against popular packages.
- A rehearsable three-minute offline demo (`demo/README.md`) with a scripted agent simulation.
