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

### Reputation limits

Download popularity lowers uncertainty for *static* capabilities: a bundler shipping minified code with an eval sink is not treated as malware because it is widely used. Popularity never rescues a **behavioural delta**. A newly added or changed lifecycle script combined with a credential read, raw IP, network call, or exec sink blocks whatever the download count says, because that is the shape of the chalk and Shai-Hulud compromises, where popularity increased the blast radius rather than reducing the risk. Name attacks, reverse shells, and the environment-exfiltration shape are likewise never suppressed.

### Verdicts

Every check returns a versioned JSON verdict (`warden schema` prints the JSON Schema): package, version, integrity, verdict, risk score 0-100, categories, evidence with file locations, and a plain-language summary. Exit codes are stable: `0` allow, `10` warn, `20` block, `30` analysis error. `--allow-risky` deliberately overrides a block and exits `10`.

Verdicts are cached in SQLite (`~/.wnpm-cache/verdicts.sqlite`) keyed by tarball integrity and analyzer version, so repeat checks are instant and re-analysis happens automatically when the analyzer changes.

## Dependency transactions

`warden plan` resolves the complete prospective dependency graph, direct and transitive, before anything is installed. It diffs that graph against the one in the lockfile, vets every added or changed package through the same engine as `warden check`, names the install scripts that are new relative to the graph already trusted, and returns one decision for the whole change. Coverage is reported rather than assumed: a truncated graph or an unanalyzed package downgrades the decision to `NEEDS_APPROVAL` instead of allowing. See [transactions](transactions.md).

## Command coverage

`warden coverage` publishes which package-manager commands are mediated, generated from the same grammar the shim executes. `npm ci`, `npm exec`, `yarn dlx`, `pnpm dlx`, `bun x`, rebuilds, and global installs are all mediated; a no-argument install is treated as a graph transaction and audits the lockfile before delegating. Non-registry sources are blocked rather than skipped, and each unsupported path is listed explicitly. See [command coverage](command-coverage.md).

## Integrations doctor

`warden integrations doctor` verifies that Warden is actually in the path of your installs rather than merely installed. It checks that the shim directory exists and comes first on `PATH`, which tools are intercepted, whether interception is switched on, which agent adapter the handoff uses, which package manager the project declares, and whether a CI workflow is present. Each non-healthy check carries the command that repairs it. Only an actively broken wiring, such as the shim directory missing from `PATH`, is fatal: the verb exits `30` in that case and `0` otherwise.

Warden preserves the package manager a project declares. Detection is ordered: the invoked binary, then `packageManager` in `package.json`, then the lockfile, then `warden.config.json`, then what is available on `PATH`, and only then a documented default of npm. `wnpm` installs through the detected manager with that manager's own verb, so a pnpm project is never quietly installed with npm.

## Interception

See [interception](interception.md).

- `wnpm` and `wnpx`: drop-in commands that vet first, then delegate to the real manager. `wnpm` falls back to npm and propagates exit codes; `wnpx` vets the package a command would execute.
- Transparent shims: the installer copies `scripts/shim.sh` over `npm`, `pnpm`, `yarn`, `bun`, `npx`, and `bunx` on PATH. Install and exec commands are vetted before the real tool runs; everything else passes straight through. No habit changes required.
- Two modes: **protect** (block risky installs before any script runs) and **observe** (never block, record verdicts to `~/.warden/log.jsonl`). `warden log --tail N` renders the recorded history.
- Per-user control via `warden config`: mode, and intercept toggles for install and exec, stored in `~/.warden/config.json` ([config](config.md)).

## Dependency doctor

`wnpm doctor` turns the same trust signals into a safe repair loop for an existing project. It reads direct dependencies and their installed versions, queries OSV advisories, and makes both a minimal and a latest upgrade plan. Every candidate is checked by the normal supply-chain gate, so an advisory's nominal fix is rejected when the release itself is risky.

Before changing the project, doctor copies it to an isolated workspace, installs with lifecycle scripts disabled, and runs any present `test`, `typecheck`, and `build` scripts. By default it pins the recommended verified versions in `package.json` and reinstalls them. `wnpm doctor --no-apply` produces the report without changing the project; `--dir <path>` targets another workspace. The JSON report records issues, rejected candidates, plans, verification steps, and whether a plan was applied.

`warden doctor` and `wnpm doctor` are the same core with identical flags, report, and exit codes. `warden schema doctor` prints the report schema.

See [docs/doctor.md](doctor.md) for the full reference.

## Check surfaces

A package check reads a published tarball. Three surfaces live in your repository instead, and `warden check lockfile`, `warden check scripts`, and `warden check config` audit them offline without executing anything.

- **Lockfile**: off-registry and impersonating hosts, plaintext transport, missing or weak integrity, git and file dependencies. Reads npm, pnpm, yarn, and bun lockfiles.
- **Scripts**: the five npm lifecycle hooks across the installed tree, flagging pipe-to-shell, raw IP endpoints, base64 payloads, credential paths, and environment exfiltration.
- **Config**: `.npmrc` in the project and home directory, flagging lookalike registries, plaintext tokens, and disabled TLS. Values are never echoed back.

See [check surfaces](check-surfaces.md) for the rule tables.

## Intent verification

`warden intent check` reads the diff against the merge base, decomposes the prompt an agent was given into atomic claims, and checks the diff against them: which claims were delivered, which were dropped, and which hunks were never requested at all. A separate deterministic scan flags calls to APIs a package doesn't export, catching diffs that reference methods that were never real.

Claim extraction and part of the matching go through an LLM (`claude`, `codex`, `openai`, `groq`, or `ollama`); the cheap keyword-overlap pass runs first, and the hallucination scan is pure static analysis that never runs code. `warden ci` runs this automatically when `.warden/prompt.txt` exists and JS/TS files changed.

See [docs/intent.md](intent.md) for the full reference, including its real limits.

## Workspace awareness

See [detection and init](detection-and-init.md).

- `warden detect` classifies the repo without touching it: topology (single package or monorepo, orchestrator), package manager and version, and per-package framework, role (app, service, library), and tooling, all with evidence.
- `warden init` onboards a repo from that manifest: writes config, a CI workflow, hooks, and agent context files, prompting per file (`--yes` accepts everything).

## CI

`warden ci` checks only what changed: it diffs dependency manifests against the merge base (`--base <ref>` to override) and vets the additions. It also audits a surface when that surface changed in the diff, so a pull request that bumps no version but repoints a lockfile or adds a `preinstall` hook still fails. Reporters: `summary` for humans, `json` for machines, `github` for workflow annotations, `agent` for coding agents, and `sarif` for GitHub code scanning. Exit codes match `check`, so a block fails the pipeline.

## Agent-first CLI

See [agent-first CLI](agent-first-cli.md).

- Structured everything: `--json` on every verb, published schemas via `warden schema`, and typed JSON error envelopes (kind, code, reason, hint) instead of free-text errors.
- Registry-authored strings are quarantined under an `untrusted` key in verdict JSON, stripped of ANSI, zero-width, bidi, and control characters, so Warden cannot become a prompt-injection vector.
- Global flags on every verb: `--json`, `--no-color`, `--quiet`, `--verbose`, `-h`, `-v`. An unknown verb suggests the closest real one.
- `warden handoff` hands the last failing check to your coding agent with full context, using the adapter chosen by `warden config agent <name>`.
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
