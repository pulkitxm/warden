# Warden — Authoritative Build Plan (Bun monorepo)

This is the canonical plan (team: Pulkit, Manas, Bhavishya; 6-hour Tuesday
hackathon). It supersedes the earlier `warden-upgrades.md` direction. Full text
of the plan lives in the team doc; this file is the working summary + the
divergence note from the already-built prototype.

## Shipping (two features, everything else is a slide)

1. **The firewall** — `wnpm install <pkg>` blocks a typosquat/malicious package
   with a specific reason before any code runs.
2. **Agent-safe mode** — `wnpx --json` emits a structured verdict a Codex agent
   reads and gates on, refusing a slopsquatted `npx` from a skill file. **This is
   the money shot.**

## Stack: Bun-native, ~3 real deps

- Bun replaces pnpm/turbo, tsup/esbuild, vitest, better-sqlite3, node-fetch,
  ssri, zlib, commander, chalk, dotenv, Verdaccio, tsx.
- Install only: `acorn` + `acorn-walk` (walkable AST), `@biomejs/biome` (dev,
  optional). Write in-house: `tar`, `sri`, `distance`, `schema`.
- CLI binaries: `wnpm`, `wnpx`, shipped via `bun build --compile`.

## Contract (freeze first): `packages/schema/schema.ts`

`Verdict` { schema_version, package, version, integrity (sha512 = cache key),
verdict allow|warn|block, risk_score 0-100, categories[], summary, evidence[],
analyzer_version, source cache|blocklist|heuristics|llm }.
Every heuristic is a pure `(AnalysisInput) => Signal[]`. One schema drives TS
types + JSON Schema + OpenAI Structured Outputs (`strict:true`).

## Output rules (non-negotiable)

- `--json`: exactly one JSON object on **stdout**, all human text to **stderr**.
- Exit codes: 0 allow, 10 warn, 20 block, 30 analysis error (fail open, loud).
- Human report snapshot-tested; `NO_COLOR` respected.

## Testing (a feature, not hygiene)

- `bun test` < 3s. Unit (table-driven heuristics + self-written primitives),
  golden snapshots, contract, integration vs a `Bun.serve` mini-registry.
- **Benign FP corpus** (esbuild/sharp/node-gyp/puppeteer/next/typescript/
  classnames/@babel): **zero blocks, always.** Enforces the two-signal rule.
- **Malicious corpus** (lodahs / axios-style 1.0.0→1.0.1 / chalk-style obfuscation
  / react-codeshift): each must block **for the right `categories`**.

## Work split (each owns plumbing + detection + their tests)

- **Manas** — install path & evidence: scaffold, schema (with B), tar/sri,
  registry, diff, heuristics A/B/C (install-script, AST content, obfuscation),
  `wnpm install` + report renderer, mini-registry + axios fixture.
- **Bhavishya** — agent path & intel: OSV+OpenSSF intel, top-10k names, distance
  (Damerau-Levenshtein + BK-tree), heuristics D/F/G (typosquat, publish-age,
  maintainer/provenance downgrade, direct-URL, dep-confusion), scorer + FP corpus,
  cache, llm (OpenAI strict + offline fallback), `wnpx --json`, slopsquat + Codex
  demo.
- **Pulkit** (Mon eve+) — integration (every breakage → a test), pre-cache demo
  verdicts (network-off demo), deck, research (`citations.md`), README, rehearsal.

## Timeline gates

- Sun eve: schema frozen on main; OSV/OpenSSF/top-10k downloaded; benign corpus
  vendored (`bun pm pack`).
- Mon 4pm gate: heuristics → scorer → real verdict for a real package. Not there
  by 5pm → cut the LLM.
- Mon 10pm gate: full DoD checklist green + one live 3-min dry run.
- Tue: 0-1 smoke+compile, 1-2 polish report, 2-3 one stretch, 3-4 deck lock,
  4-5 buffer (schedule nothing), 5-6 submit + backup video.

## Cut lines

Behind Mon 5pm → cut LLM. Behind Mon 10pm → cut the axios-diff beat. Tue hour 2
rough → cut dashboard/SARIF/audit. **Never cut: the `--json` verdict or the FP
corpus.**

## Definition of done — see the checklist in the team plan (§12).

---

## Divergence from the already-built prototype (IMPORTANT)

A working MVP already exists on branch `build-warden-mvp`, but in a **different
stack** than this plan:

| Dimension | Built prototype | This plan |
|---|---|---|
| Runtime/toolchain | Node 24 + pnpm + tsc + vitest | Bun (single runtime) |
| CLI names | `warden` / `bnpm` / `bnpx` | `wnpm` / `wnpx` |
| LLM provider | Anthropic (Haiku) | OpenAI Structured Outputs (Codex event) |
| Cache key | `package@version` | `dist.integrity` (SRI) |
| Layout | flat `src/` | `apps/` + `packages/` monorepo |
| Deps | tar, @babel/parser, @anthropic-ai/sdk | acorn(+walk), (biome) |

**Recommendation: reuse the prototype as a porting source, not the deliverable.**
The runtime-agnostic logic ports almost verbatim into the Bun `packages/`:
- `src/heuristics/scriptScan.ts` → `packages/heuristics` (swap @babel/parser → acorn+acorn-walk).
- `src/heuristics/nameDistance.ts` → `packages/distance` (upgrade to Damerau + BK-tree).
- `src/heuristics/obfuscation.ts` (entropy) → `packages/heuristics`.
- `src/diff.ts` → `packages/tar` + `packages/diff` (swap `tar` dep → in-house ustar parser on `Bun.gunzipSync`).
- `src/registry.ts` → `packages/registry` (add provenance/signature extraction).
- `src/heuristics/index.ts` scoring + the newness-only-escalates rule → `packages/score`.
- Verdict schema in `src/types.ts` → `packages/schema` (rename fields to the plan's contract).
- The Claude Code hook adapter logic (`src/adapters/`) is reusable for the agent demo but the LLM call switches Anthropic → OpenAI.

The `better-npm-hackathon-concept.md` and the verified `research/citations.md`
here feed the deck directly.

## Assumptions

- This plan is now authoritative; the built Node MVP is reference/porting source
  unless the team decides to keep Node. Flag if that assumption is wrong.
- OpenAI (not Anthropic) is the LLM provider, per the Codex hackathon framing.
