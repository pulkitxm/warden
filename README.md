# Warden

**A trust layer for npm that thinks before it executes.**

Every `npm install` and `npx` run today is a blind leap of faith: no diff, no
history, no signal, just a bare version number and a prayer. Warden diffs every
new or changed package against its last trusted release, scores it with
deterministic supply-chain heuristics plus an optional LLM explanation, and
blocks anything high-risk before a single script runs — whether a human typed
the command or a coding agent (Claude Code, Codex) did.

> Hackathon MVP. See [`docs/PRD.md`](docs/PRD.md) for the full product spec and
> [`docs/DEMO.md`](docs/DEMO.md) for the demo runbook.

## Why

- Coding agents now run `npm install` / `npx` autonomously from skill files with
  no human reviewing them first.
- Supply-chain attacks escalated hard (454k+ malicious npm packages in 2025).
  The dangerous cases are increasingly **hijacked legitimate packages** — which
  scoring a package in isolation misses but a **diff against the prior version**
  catches.
- `npm audit` scores theoretical CVSS with no reachability, so most teams ignore
  it. Warden scores *behavior* and produces a verdict an agent can read.

## How it works

```
              ┌──────────────────────────────────────┐
 warden CLI ─▶│              Verdict Engine           │
 agent hook ─▶│  cache → registry → diff → heuristics │─▶ verdict JSON
 --json     ─▶│         → enrich → (LLM verdict)       │
              └──────────────────────────────────────┘
```

- **Deterministic heuristics** do the detecting: added lifecycle scripts,
  AST-scanned suspicious script content (curl-to-shell, eval, base64, raw IPs,
  env exfiltration), typosquat edit-distance to popular packages, obfuscation,
  maintainer changes, and writes to agent-config paths (`.claude/`, `.codex/`).
- **Newness never raises risk on its own** — a brand-new, script-free package
  scores LOW. Recency/low-installs only escalate alongside a real action signal.
- **The LLM only writes the explanation**, only on escalation, from a compact
  signal JSON (never raw files). Degrades to a templated explanation with no key.
- **Verdicts cache per immutable `package@version`** — scored once, ever, for
  everyone. Marginal cost per install ≈ zero.

## Install

> The npm name `warden` is taken by an unrelated package — install from this
> repo, not from the registry.

```sh
bun install
bun run build
npm link          # puts `warden`, `bnpm`, `bnpx` on PATH
```

## Usage

```sh
# Score one package (human report)
warden check express

# Machine-readable verdict for an agent
warden check some-cli@latest --json

# Gated install — blocks HIGH by default, runs pnpm under the hood
bnpm install left-pad chalk

# Rich pre-run prompt / agent verdict for npx
bnpx some-cli@latest --json
```

Exit codes: `0` allowed/clean · `1` blocked (HIGH risk) · `2` usage error.

### Coding-agent integration

The [Claude Code adapter](adapters/claude-code/) ships a **PreToolUse hook**
(deterministic enforcement, holds under prompt injection) plus a **skill**
(teaches the agent to check first and act on verdicts). The hook blocks a
HIGH-risk `npm install`/`npx` mid-loop with a plain-English reason the agent
reads and self-corrects from.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the LLM explanation (Haiku). Optional — heuristics work without it. |
| `WARDEN_CACHE_DIR` | Verdict cache location (default `~/.warden-cache`). |
| `WARDEN_LLM_MODEL` | Override the model (default `claude-haiku-4-5`). |
| `WARDEN_REGISTRY` | Override the npm registry base URL. |
| `WARDEN_DEBUG` | Print LLM-call count per run (for the cache-hit metric). |

## Develop

Bun is the runtime and toolchain (tests, dev runner, lockfile); `tsc` builds
the Node-compatible `dist/` and type-checks; Biome lints and formats. Code
comments are disallowed and enforced in CI.

```sh
bun test                  # offline engine + parser tests
bun run test:coverage     # enforces the 100% coverage threshold
bun run typecheck
bun run lint              # biome ci
bun run format
bun run strip-comments    # remove any code comments (CI runs --check)
```

## Status & roadmap

Core engine, CLI, and Claude Code hook are working (MVP). Not yet built:
sandboxed script execution, the registry firehose worker for proactive scoring,
reachability-aware `warden audit`, and the Codex execpolicy adapter. See
[`docs/PRD.md`](docs/PRD.md) §8.
