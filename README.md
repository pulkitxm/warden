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

## Install & use

Warden needs [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

```sh
git clone https://github.com/pulkitxm/warden && cd warden
bun install
bun run build          # produces ./dist/wnpm and ./dist/wnpx (standalone binaries)

# Put them on your PATH (any one of):
bun link                       # exposes `wnpm` and `wnpx`
# or copy ./dist/wnpm ./dist/wnpx into a directory on your PATH
# or run directly: bun apps/cli/src/wnpx.ts <pkg>
```

### For a developer

```sh
# Vet-and-install: blocks a bad package before any script runs
wnpm install left-pad                 # exit 0 (allowed) and installs
wnpm install lodahs                   # exit 20 (BLOCK: typosquat of lodash)

# Inspect one package before running it
wnpx some-cli@latest                  # human report on stderr
wnpm install --allow-risky <pkg>      # override a block if you are sure
```

Exit codes double as a CI gate: `0` allow, `10` warn, `20` block, `30` analysis
error. `wnpm install || exit 1` fails the build on a block for free.

### For a coding agent (Codex, etc.)

The agent runs `wnpx --json` before executing any `npx`/install command and
gates on the verdict:

```sh
wnpx react-codeshift --json
# {"verdict":"block","categories":["slopsquat"],"risk_score":90, ...}   exit 20
```

- **Exactly one JSON object on stdout** (all human output goes to stderr), so it
  pipes cleanly into a tool result.
- `wnpx --schema` prints the JSON Schema so an agent can self-describe the
  contract.
- Gate rule: `block` → do not run, tell the user why; `warn` → confirm first;
  `allow` → proceed.

A ready-to-use skill-file + policy is in `demo/skill-file/AGENTS.md`, and
`demo/agent-sim.ts` shows the full gating loop.

### Configuration (env vars)

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | Enables the LLM plain-English summary (optional; heuristics work without it). |
| `WARDEN_CACHE` | Verdict cache path (default `~/.warden-cache/verdicts.sqlite`; `:memory:` for none). |
| `WARDEN_LLM_MODEL` | LLM model (default `gpt-4o-mini`). |
| `WARDEN_REGISTRY` / `WARDEN_DOWNLOADS` | Point at a different registry / downloads API (used by the offline demo). |
| `NO_COLOR` | Disable ANSI colors. |

### Try it offline (no network, no risk)

```sh
bun fixtures/registry/server.ts   # terminal A: mini npm registry on :4873
export WARDEN_REGISTRY=http://localhost:4873 \
       WARDEN_DOWNLOADS=http://localhost:4873/downloads/point/last-week
wnpm install acme-http@1.0.1      # BLOCK: hijacked-diff (provenance + exfil)
bun demo/agent-sim.ts demo/skill-file/AGENTS.md   # the agent refuses react-codeshift
```

> ⚠️ **Current status:** the engine is validated against the offline mini-registry.
> Live-registry testing surfaced false positives on some real packages (e.g.
> `esbuild`, `next`) that are being recalibrated — see
> `Task_tracker/issues.md` and `Task_tracker/improvement-plan.md`. Use the
> offline demo for now; `wnpx lodahs` and the agent-sim beat are accurate live.

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
