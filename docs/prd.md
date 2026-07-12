# Warden — Product Requirements Document

_Status: v0.1 (hackathon MVP) · Last updated: 2026-07-04_

## 1. Summary

Warden is an open-source trust layer for the npm ecosystem. It diffs every new or
changed package against its last trusted version, scores it with deterministic
supply-chain heuristics plus an optional LLM-written explanation, and blocks
high-risk packages **before any install script runs** — for a human typing at a
terminal or a coding agent (Claude Code, Codex) executing installs autonomously.

The same verdict engine is exposed three ways: a CLI wrapper (`warden`), a
machine-readable API for agents (`warden check --json`), and PreToolUse hook
adapters that plug into coding agents so protection is enforced deterministically,
even under prompt injection.

## 2. Problem

- npm `install`/`npx` give almost no pre-execution signal: a bare version number and
  a yes/no prompt. Coding agents now run these commands autonomously from skill
  files with no human reviewing them.
- Supply-chain attacks have escalated (Sonatype: 454k+ new malicious npm packages in
  2025; Shai-Hulud worm; hijacked `chalk`/`debug`/axios releases). The dangerous
  cases are increasingly **hijacked legitimate packages** — where scoring a package
  in isolation misses the signal that a diff against the prior version would catch.
- `npm audit` scores theoretical CVSS with no reachability, so 65% of teams ignore
  it. Existing pre-install tools (npq, Socket safe-npm, Prismor) either score in
  isolation, are proprietary black boxes, or are not built for agent consumption.

## 3. Goals / Non-Goals

**Goals (MVP)**
- G1. Block high-risk package installs before lifecycle scripts execute, by default,
  with an explicit `--allow-risky` override.
- G2. Produce a structured `--json` verdict an agent can read and self-correct from.
- G3. Diff new-or-changed versions against the last trusted version; surface concrete
  evidence ("postinstall script _added_", "maintainer _changed_").
- G4. Work standalone with zero LLM key (heuristics-only); LLM is optional escalation.
- G5. Score each `package@version` once and cache the verdict (cost-viable, fast).
- G6. Ship a Claude Code PreToolUse hook adapter as the demo centerpiece.

**Non-Goals (MVP)**
- Custom dependency resolver (we wrap pnpm).
- Registry-level authority (forced unpublish, name-squatting disputes).
- Novel/zero-day vulnerability discovery (we consume OSV/deps.dev for known CVEs).
- Full runtime sandboxing of install scripts (documented as post-MVP; see §8).
- Backfill-scoring the entire existing registry (lazy scoring + top-N backfill only).

## 4. Users

- **U1 — Developer at the terminal:** wants `npm install` safety without changing habits.
- **U2 — Coding agent (Claude Code / Codex):** needs a structured verdict before
  executing an install/`npx` command; must be blockable deterministically.
- **U3 — Team/CI (post-MVP):** org policy, private registry scanning.

## 5. Functional Requirements

### 5.1 Verdict engine (core)
- FR1. Given `name@version`, resolve metadata via the npm registry packument API
  (maintainers, `time`/publish dates, tarball URL) and download stats.
- FR2. Fetch the current and previous-version tarballs and produce a structured diff:
  added/removed files, and specifically the `package.json` `scripts` delta.
- FR3. Extract deterministic signals: added lifecycle scripts; suspicious script
  content (AST-parsed: `curl`/`wget`, `eval`/`Function`, base64 chains, raw IPs,
  env exfiltration); name edit-distance to popular packages; obfuscation proxy
  (minification ratio / entropy); publish recency; maintainer change; account age;
  install velocity; **writes to agent-config paths (`.claude/`, `.codex/`, `AGENTS.md`)**.
- FR4. Combine signals into a 0–10 risk score and a level (LOW/MEDIUM/HIGH). Newness
  alone must never exceed LOW; it only escalates when paired with an action signal.
  Maintain a trusted-maintainer fast path.
- FR5. Enrich best-effort from free APIs: OSV.dev (known CVEs for the resolved
  version), deps.dev (license, dependency graph, health), OpenSSF Scorecard (repo
  health, when available). Any miss/timeout is omitted, never fatal.
- FR6. When (and only when) heuristics cross an escalation threshold, call an LLM with
  a **compact signal JSON** (never raw file contents) to produce a plain-English
  explanation + recommendation. Structured output; small/cheap model; degrade
  gracefully to a templated explanation with no key set.
- FR7. Cache the full verdict keyed on `name@version` (immutable). Cache-first on every
  request. Local cache for MVP; pluggable remote KV interface for later.

### 5.2 CLI
- FR8. `warden check <name[@version]> [--json]` — score one package; human report or
  structured JSON. Exit non-zero on HIGH unless `--allow-risky`.
- FR9. `warden install [pkgs...]` (`bnpm`) — run `pnpm install` with scripts disabled,
  score every new/changed package in the resolved set, print a trust report, block
  HIGH by default, then re-enable scripts only for cleared packages.
- FR10. `warden npx <pkg>` (`bnpx`) — rich pre-run prompt + `--json` for agents.

### 5.3 Agent adapters
- FR11. Claude Code PreToolUse hook: match install/`npx` Bash commands, parse the
  package(s), call the engine, and return a `deny` decision with the plain-English
  verdict as the reason on HIGH. Must handle command shapes (`npm i`, `pnpm add -D`,
  `npx foo@latest`, compound `a && b`) and fail safe on parse failure.
- FR12. Codex adapter (stretch): equivalent hook + execpolicy `.rules` file.

## 6. Verdict schema (contract)

```json
{
  "package": "is0dd@1.0.3",
  "risk_score": 8.5,
  "level": "HIGH",
  "flags": ["typosquat", "new_postinstall", "network_in_script", "obfuscated"],
  "evidence": [
    "name is 1 edit from \"is-odd\" (2M weekly downloads)",
    "postinstall script added (previous versions had none)",
    "script makes an outbound request to an unrecognized host"
  ],
  "explanation": "Likely a typosquat of is-odd ...",
  "recommendation": "block",
  "cached": false,
  "engine_version": "0.1.0"
}
```

`recommendation` ∈ `allow | confirm_with_human | block`. This schema is the stable
contract shared by the CLI `--json`, the agent adapters, and the cache.

## 7. Success metrics (hackathon)

- M1. Correctly blocks a planted typosquat with a postinstall payload; installs a
  clean package unchanged.
- M2. Agent demo: agent instructed to run a malicious `npx` is blocked mid-loop and
  visibly self-corrects from the JSON reason.
- M3. Second run of the same install produces **zero** LLM calls (cache hit) — a
  number shown live.
- M4. Heuristics-only mode (no API key) still produces a correct block/allow verdict.

## 8. Post-MVP / roadmap

- Sandboxed script execution (no network egress by default + host allowlist) as an
  enforcement layer independent of static scoring.
- Registry firehose worker (`replicate.npmjs.com` changes feed) for proactive,
  zero-latency scoring of every new publish.
- Reachability-aware `warden audit`.
- Codex execpolicy + Cursor/Gemini adapters.
- Shared hosted verdict cache; org policies; private-registry ergonomics.

## 9. Architecture (MVP)

```
                 ┌──────────────────────────────────────┐
   warden CLI ──▶│              Verdict Engine           │
   agent hook ──▶│  cache → registry → diff → heuristics │──▶ verdict JSON
   --json     ──▶│         → enrich → (LLM verdict)       │
                 └──────────────────────────────────────┘
                    │         │         │          │
                 npm reg   tarballs  OSV/deps.dev  Anthropic
                                     /Scorecard    (optional)
```

Single TypeScript package for MVP; module boundaries mirror the components above so
they can be split into a workspace later. LLM provider: Anthropic (Haiku-class),
behind a provider interface so it is swappable.
