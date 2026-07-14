# Functionality walkthrough

What warden does today, shown with real command output. Every log below was captured from a build of the current codebase. See [features](features.md) for the one-line inventory and the linked design docs for internals.

warden vets npm packages before they install or execute. It resolves the package against the registry, verifies tarball integrity, diffs the release against the previous version, scans the code with an AST walk, compares the name against popular packages, checks curated intel, and scores everything into a deterministic allow, warn, or block verdict.

Exit codes are stable everywhere: `0` allow, `10` warn, `20` block, `30` analysis error.

```
$ warden --help
warden: vets packages and enforces repo policy before code runs

usage: warden <verb> [flags]

  check        vet packages, the lockfile, scripts, or registry config
  ci           run all checks against the merge-base diff
  intent       verify the diff does what the prompt asked
  detect       classify the workspace (framework, role, tooling per package)
  init         onboard a repo: config, workflow, hooks, agent context
  fix          hand the last failing check to your coding agent
  config       read or set user-level settings (mode, intercept, agent)
  uninstall    remove Warden, its shims, config, cache, and shell setup
  log          render recorded verdicts from ~/.warden/log.jsonl
  schema       print the JSON schema for structured output
  completions  print a shell completion script
  version      print the warden version

exit codes: 0 allow · 10 warn · 20 block · 30 error
docs: https://github.com/pulkitxm/warden
```

## Installation

`install.sh` detects the OS, architecture, and shell, finds the package managers on PATH, installs the three binaries to `~/.warden/bin`, copies shims over the managers you have, wires PATH and completions into the shell rc, and links into `/usr/local/bin` when it can. It prompts once for the protection mode.

```
$ sh install.sh

warden installer

  system     linux arm64
  shell      bash (/root/.bashrc)
  managers   npm 9.2.0, bun 1.3.14 found
  existing   none

using local source /app
When warden finds a risky package:
  1) protect  stop the install and show why  (recommended)
  2) observe  never stop anything, just keep a record
choice [1]:
  installed  ~/.warden/bin/warden, wnpm, wnpx
  shims      npm bun npx bunx
  PATH       added ~/.warden/shims and ~/.warden/bin to /root/.bashrc

  config     ~/.warden/config.json  (mode: brief, intercept: install+exec)

done; warden is ready in this shell (linked into /usr/local/bin)

IMPORTANT: package-manager interception is NOT active in this shell yet.
activate it now:  exec bash
new shells pick it up automatically
verify with: warden check left-pad
```

Upgrades preserve config, and `warden uninstall` removes everything the installer placed.

## Vetting packages: `warden check`

A clean package passes with the reasoning shown:

```
$ warden check left-pad

ALLOW  left-pad@1.3.0  risk 10/100 · heuristics
  categories: metadata_anomaly
  • package is marked deprecated (package.json)

  verdict: No supply-chain risk signals of concern for left-pad@1.3.0.
```

A known-compromised release blocks instantly from the curated blocklist, before any script runs. `chalk@5.6.1` is a real incident (the September 2025 npmjs.help phishing wave):

```
$ warden check chalk@5.6.1

BLOCK  chalk@5.6.1  risk 100/100 · blocklist
  categories: known_malware
  • blocklist entry MAL-CHALK-2025

  verdict: chalk@5.6.1 is on the known-malware blocklist (MAL-CHALK-2025). Installation blocked.
  blocked before any script ran — override with --allow-risky
$ echo $?
20
```

Typosquats block from name analysis backed by a download-count popularity table:

```
$ warden check lodahs

BLOCK  lodahs@0.0.1-security  risk 60/100 · heuristics
  categories: typosquat, metadata_anomaly
  • name is 1 edit from popular package "lodash" (~300M weekly downloads) (package.json)
  • low install history (42 weekly downloads) (package.json)

  verdict: lodahs@0.0.1-security should not be installed: name is 1 edit from popular package "lodash" (~300M weekly downloads); low install history (42 weekly downloads).
  blocked before any script ran — override with --allow-risky
```

Every verb takes `--json` and returns a versioned verdict, with the schema published via `warden schema`:

```
$ warden check chalk@5.6.1 --json
{"schema_version":1,"package":"chalk","version":"5.6.1","integrity":"","verdict":"block","risk_score":100,"categories":["known_malware"],"summary":"chalk@5.6.1 is on the known-malware blocklist (MAL-CHALK-2025). Installation blocked.","evidence":[{"file":"-","detail":"blocklist entry MAL-CHALK-2025"}],"analyzer_version":"0.1.0","source":"blocklist"}
```

Verdicts are cached in SQLite keyed by tarball integrity and analyzer version, so repeat checks are instant. `--allow-risky` deliberately overrides a block and exits `10`. An optional OpenAI pass (`OPENAI_API_KEY`) can rewrite the summary but can never change the verdict.

## Interception: shims, `wnpm`, and `wnpx`

The installer copies a transparent shim over `npm`, `pnpm`, `yarn`, `bun`, `npx`, and `bunx` on PATH. Install and exec commands are vetted first; everything else passes straight through, so no habits change. A risky install stops before the real manager ever runs:

```
$ npm install chalk@5.6.1

BLOCK  chalk@5.6.1  risk 100/100 · blocklist
  categories: known_malware
  • blocklist entry MAL-CHALK-2025

  verdict: chalk@5.6.1 is on the known-malware blocklist (MAL-CHALK-2025). Installation blocked.
  blocked before any script ran — override with --allow-risky
warden: blocked chalk@5.6.1; override with --allow-risky
$ echo $?
20
```

`wnpm` is the explicit drop-in command: it vets, then delegates to the real manager with lifecycle scripts disabled and propagates its exit code:

```
$ wnpm install left-pad
Warden: vetting 1 package(s) before install
  ALLOW left-pad@1.3.0  metadata_anomaly

vetted; installing via pnpm with lifecycle scripts disabled...
Packages: +1
+
Progress: resolved 1, reused 0, downloaded 1, added 1, done

dependencies:
+ left-pad 1.3.0 deprecated

Done in 263ms using pnpm v10.33.0
```

```
$ wnpm install chalk@5.6.1
Warden: vetting 1 package(s) before install
  BLOCK chalk@5.6.1  known_malware

BLOCK  chalk@5.6.1  risk 100/100 · blocklist
  categories: known_malware
  • blocklist entry MAL-CHALK-2025

  verdict: chalk@5.6.1 is on the known-malware blocklist (MAL-CHALK-2025). Installation blocked.
  blocked before any script ran — override with --allow-risky

install blocked: 1 package(s) failed the trust check. Override with --allow-risky.
$ echo $?
20
```

`wnpx` vets the package a command would execute without running it:

```
$ wnpx cowsay@1.6.0

ALLOW  cowsay@1.6.0  risk 0/100 · heuristics

  verdict: No supply-chain risk signals of concern for cowsay@1.6.0.
(would execute: npx cowsay@1.6.0)
```

## Modes and settings: `warden config`

Two modes: **protect** blocks risky installs, **observe** (`mode: log`) never blocks and records every verdict instead. Interception is toggled per command class:

```
$ warden config
{
  "mode": "brief",
  "intercept": {
    "install": true,
    "exec": true
  }
}
$ warden config mode log
reporting mode set to log
$ warden config intercept exec off
exec interception disabled
$ warden config
{
  "mode": "log",
  "intercept": {
    "install": true,
    "exec": false
  }
}
```

## Verdict history: `warden log`

In observe mode the shim appends every verdict to `~/.warden/log.jsonl`, and `warden log` renders the history:

```
$ npm install debug@4.4.2
$ warden log --tail 3
unknown-time BLOCK debug@4.4.2 risk=100 known-malware
```

## Workspace awareness: `warden detect` and `warden init`

`warden detect` classifies the repo without touching it: topology, package manager, and per-package framework, role, and tooling, each with evidence. Run on this repository:

```
$ warden detect
single package · bun · node unspecified · 1 package

  .                    CLI            tooling   ts, bun test, biome

evidence:
  topology     package.json single package, package.json without node engine
  .            bin in package.json, tsconfig.json, bun test in package.json scripts, biome.json
```

`warden init` onboards a repo from that manifest, prompting per file (`--yes` accepts everything):

```
$ warden init --yes
single package · npm · node unspecified · 1 package

  .                    library        library   js, no test runner

evidence:
  topology     package.json single package, package.json without node engine
  .            package.json has no bin or framework dependency, package.json without tsconfig.json, package.json has no test runner dependency or script
wrote: warden.config.json, .github/workflows/warden.yml
skipped: nothing
```

## CI: `warden ci`

`warden ci` diffs dependency manifests against the merge base and vets only the additions, so a poisoned dependency bump fails the pipeline. Reporters: `summary`, `json`, `github` (workflow annotations), and `agent`.

```
$ warden ci
Warden CI · diff vs merge-base af8d006d7875 · 1 package changed

  deps  BLOCK chalk@5.6.1  package.json  blocklist entry MAL-CHALK-2025
$ echo $?
20
```

With no dependency changes it short-circuits:

```
$ warden ci
Warden CI · diff vs merge-base 1c216f09730c · 0 packages changed

  no dependency changes
```

## Dependency repair: `wnpm doctor`

`wnpm doctor` audits a project's direct dependencies against OSV advisories, builds minimal and latest upgrade plans, gates every candidate through the same check as `warden check`, verifies the surviving plans by installing and running the project's own tests in an isolated workspace, then applies the recommended plan by default. A candidate that fails the supply-chain gate is rejected even when an advisory names it as the official fix:

```
$ wnpm doctor
Warden doctor — doctor-demo

  2 issue(s) found — 2 affect production
  critical  acme-http@1.0.0 [GHSA-ACME-HTTP-0001]
    acme-http request smuggling via keep-alive header handling (fixed in 1.0.1)
  high  acme-json@2.1.0 [GHSA-ACME-JSON-0001]
    acme-json prototype pollution through __proto__ keys (fixed in 2.1.4)

  BLOCK  acme-http@1.0.1  install_script, exfiltration, provenance_downgrade, metadata_anomaly
    postinstall lifecycle script added; code requires child_process; code contains a raw IP address literal.

  UNFIXABLE acme-http — every candidate fix was blocked by the supply-chain gate

  plan minimal — smallest safe upgrade  ▸ recommended
    acme-json 2.1.0 -> 2.1.4  patch, in range
    verification: install ok 339ms · test ok 260ms — passed

  recommended plan applied to package.json
```

## Intent verification: `warden intent check`

`warden intent check` decomposes a prompt into claims with one LLM call, then checks the diff against each claim: matched deterministically first by keyword overlap, then by a second LLM call for whatever is left unmatched. A separate deterministic AST scan flags calls to APIs a package doesn't export:

```
$ warden intent check --prompt "add rate limiting to the api client, keep the retry logic, and log every rate-limited request"
intent claims (3):
  c1  [behavior]  Add rate limiting to the API client.
  c2  [preservation]  Preserve the existing retry logic.
  c3  [behavior]  Log every request affected by rate limiting.

VERDICT: 2 ✅ · 1 ❌ · 1 ⚠️ · 1 🚨

  ✅ Add rate limiting to the API client.  [api-client.ts:1-39]
  ✅ Preserve the existing retry logic.  [no change touches it]
  ❌ DROPPED: Log every request affected by rate limiting.  [no matching change found]
  ⚠️ SCOPE CREEP: pagination.ts — 55 lines changed, never requested  [pagination.ts:1-57]
  🚨 HALLUCINATED: axios.instance.throttle  [api-client.ts:27]
     axios instance has no member 'throttle'. Known: get, post, put, delete, patch, head, options, request, …
$ echo $?
20
```

The hallucination scan only covers a small curated set of packages plus whatever `node_modules` can be statically proven to have a closed export surface, and only checks member accesses on added lines: see [intent](intent.md) for the exact limits.

## Agent-first output

Every verb supports `--json`, errors are typed JSON envelopes (kind, code, reason, hint), and `warden fix` hands the last failing check to your configured coding agent with full context. `warden schema` prints the verdict schema:

```
$ warden schema | head -12
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "package",
    "version",
    "integrity",
    "verdict",
    "risk_score",
    "categories",
    "summary",
```

## Shell completions

Completions for bash, zsh, and fish are generated from the same command registry as the CLI itself, so they never drift from the real verbs and flags. The installer wires them into the shell rc:

```
$ warden completions bash | head -6
_warden() {
  local cur
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W 'check ci intent detect init fix config uninstall log schema completions version' -- "$cur") )
```
