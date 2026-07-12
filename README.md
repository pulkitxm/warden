# Warden

**A trust layer for npm that thinks before it executes.**

Warden diffs every new or changed package against its last trusted version,
scores it with deterministic supply-chain heuristics plus an optional LLM
explanation, and blocks anything high-risk **before a single install script
runs** — whether a human typed the command or a coding agent (Codex) did.

Two features carry the product:

1. **The firewall** — `wnpm install <pkg>` blocks a typosquatted or malicious
   package, with a specific reason, before any code runs.
2. **Agent-safe mode** — `wnpx --json` emits a structured verdict a coding agent
   reads and gates on, refusing a slopsquatted `npx` from a skill file.

## Stack

Bun-native, ~3 real dependencies. Bun provides the runtime, test runner,
bundler, SQLite, fetch, gzip, and single-binary compile. We install only
`acorn` + `acorn-walk` (walkable JS AST) and write the rest in-house
(`tar`, `sri`, `distance`, `schema`).

## Layout

```
apps/cli/            wnpm + wnpx (bun build --compile → single binary)
packages/
  schema/            the frozen Verdict/Signal contract + JSON Schema
  distance/          Damerau-Levenshtein + BK-tree + homoglyph/delimiter norm
  tar/  sri/         in-house ustar reader + SRI on Bun primitives
  heuristics/        rules A–G, each a pure (input) => Signal[]
  score/             Signal[] → verdict, two-signal-to-block, FP corpus
  registry/ diff/    packument + tarball fetch; file→SRI diff, skip-identical
  intel/             OSV + OpenSSF malicious-package blocklist
  cache/             bun:sqlite, keyed by dist.integrity
  llm/               stage-2 verdict (OpenAI Structured Outputs) + fallback
fixtures/            mini-registry, malicious + benign (false-positive) corpora
research/            verified attack citations + the concept report
```

## Develop

```sh
bun install
bun test           # < 3s, offline; the false-positive corpus gates every rule
bun run build      # compile wnpm + wnpx standalone binaries
```

## Design notes

- **Deterministic first, LLM second.** Heuristics do the detecting; the LLM only
  writes the explanation, only on escalation, and its verdict is cached by
  `dist.integrity` so each version is analyzed once, ever, for everyone.
- **Newness never blocks on its own.** Recent-publish / low-installs only count
  alongside an action signal. Delimiter/plural name variants of real packages
  (class-names vs classnames) are low-weight — the false-positive corpus
  (`esbuild`, `sharp`, `next`, `@babel/*`, …) must never block.
- **One JSON object on stdout, humans on stderr.** That contract is what makes
  `--json` pipeable and agent-safe.

See `PLAN.md` for the build plan and `research/` for the attack citations.
