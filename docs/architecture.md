# Architecture

Warden is a supply-chain trust layer for npm: it resolves, diffs, and scores a
package **before** anything from it executes, and emits a stable verdict that
both humans and coding agents can act on.

## Repository layout

```
.
├── src/                  the Warden engine + CLIs (this package, `warden`/`bnpm`/`bnpx`)
│   ├── engine.ts         checkPackage() — the one pipeline every surface calls
│   ├── registry.ts       npm packument + downloads client, semver resolution
│   ├── diff.ts           tarball fetch/extract/diff (size- and entry-capped)
│   ├── heuristics/       deterministic signal extraction + scoring
│   ├── enrich/           best-effort OSV.dev / deps.dev signals
│   ├── verdict/          explanation providers (template / Anthropic API)
│   ├── cache/            verdict cache (file-backed + in-memory)
│   ├── cli/              command layer (main) + thin bin shims
│   ├── adapters/         shell-command parser for the agent hook
│   └── utils/            shared http + semver helpers
├── adapters/claude-code/ Claude Code hook config + skill (see agents.md)
├── test/                 offline test suite (100% line+function coverage, enforced)
├── scripts/              repo tooling (comment stripper)
├── docs/                 this documentation
├── task-tracker/         planning and research notes
└── wnpm/                 sibling project: the Warden Bun monorepo (wnpm/wnpx CLIs,
                          its own git repository and README)
```

## The verdict pipeline

Every surface — `warden check`, `warden npx`, `warden install`, the Claude Code
hook — funnels into a single function, `checkPackage(spec)` in
[`src/engine.ts`](../src/engine.ts):

```
spec ─▶ parseSpec ─▶ registry ─▶ cache? ─▶ tarball diff ─▶ heuristics ─▶ enrich
                                   │                                        │
                                   ▼                                        ▼
                                verdict ◀───────── explanation ◀───────── score
```

1. **parseSpec** — splits `name@version`, respecting scopes (`@scope/pkg@1.0.0`),
   unwrapping npm aliases (`safe@npm:real-pkg@1.0.0` vets `real-pkg`), and
   treating a trailing `@` as `latest`.
2. **registry** ([`src/registry.ts`](../src/registry.ts)) — fetches the
   packument, resolves dist-tags, exact versions, and semver ranges
   (`^`, `~`, wildcards, comparators, `||`) via the built-in resolver in
   [`src/utils/semver.ts`](../src/utils/semver.ts). A requested exact version
   that no longer exists **throws** rather than silently analyzing a different
   version. Weekly downloads are fetched best-effort.
3. **cache** ([`src/cache/index.ts`](../src/cache/index.ts)) — verdicts are
   keyed on the immutable `name@version`, so a version is scored once, ever.
   File-backed by default (`~/.warden-cache`), in-memory for tests.
4. **diff** ([`src/diff.ts`](../src/diff.ts)) — downloads the current and
   previous tarballs (64 MB download cap, 20k entry cap, 512 KB per-file text
   cap), extracts them, and produces added/changed/removed files plus the
   lifecycle-script delta. If the previous tarball is gone, the script delta is
   recovered from registry metadata; if the current tarball fails entirely, the
   engine degrades to a **metadata-only diff** that still carries the script
   signals — a fetch failure never silences a malicious postinstall.
5. **heuristics** — see [heuristics.md](heuristics.md). Pure functions over
   the metadata + diff; no network.
6. **enrich** ([`src/enrich/index.ts`](../src/enrich/index.ts)) — optional,
   time-boxed lookups: OSV.dev known vulnerabilities and deps.dev copyleft
   licenses. A timeout or error omits the signal, never fails the pipeline.
7. **verdict** ([`src/verdict/index.ts`](../src/verdict/index.ts)) — the
   deterministic score decides the level; the explanation is either templated
   (default) or written by an LLM when `ANTHROPIC_API_KEY` is set **and** the
   level escalated to MEDIUM/HIGH. The LLM can never lower the recommendation
   below the deterministic floor.

## Design invariants

- **Determinism decides; the LLM narrates.** Block/allow is a pure function of
  signals. The LLM only rewrites the human explanation, on escalation only.
- **Fail-safe surfaces, fail-loud analysis.** The agent hook never blocks a
  command because Warden itself errored, but analysis errors inside
  `warden check` exit non-zero rather than fabricating a verdict.
- **Newness is not risk.** Recency and low downloads only count alongside a
  concrete action signal (script, network, obfuscation, agent-config write).
- **Immutable cache keys.** `name@version` never changes on npm, so cached
  verdicts are valid forever and shareable.
- **Node-compatible output.** `src/` builds with `tsc` to a plain-Node `dist/`;
  Bun is the dev runtime and test runner, never a runtime requirement for
  users.

## Relationship to the `wnpm/` monorepo

`wnpm/` is the second-generation implementation of the same product as a Bun
workspace (packages for registry/tar/sri/diff/heuristics/score/distance/intel/
llm/cache/schema, `wnpm`/`wnpx` CLIs, a mini-registry fixture, and offline
vulnerability/generalization suites). It is an independent git repository with
its own README and task-tracker; this package and it share concepts but no
code. Notable differences: it keys its cache on the tarball's `dist.integrity`
hash (stronger than `name@version`), verifies SRI before analysis, and ships a
curated blocklist/hallucinated-name intel package.
