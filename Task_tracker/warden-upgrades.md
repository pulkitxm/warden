# Warden — Detection Upgrades Backlog

> **`PLAN.md` is now the authoritative plan** (Bun monorepo, `wnpm`/`wnpx`,
> OpenAI). This file remains a valid detection-upgrade backlog — the SRI cache
> key, blocklist, typosquat, and provenance items below apply regardless of
> runtime and map onto the plan's `packages/` (see PLAN.md divergence table).

Derived from the bnpm/Warden research report (2026-07-04). Each item maps to real
files in this repo, with the gap it closes, effort (S/M/L), and how to verify.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

Baseline already built (branch `build-warden-mvp`): registry client, tarball diff,
heuristic scorer, verdict cache, LLM verdict (Haiku, escalation-gated), CLI
(`warden`/`bnpm`/`bnpx`), Claude Code hook adapter, 26 tests. See `README.md`,
`docs/PRD.md`, `docs/DEMO.md`.

---

## P0 — Highest impact, do first

- [ ] **Content-address the cache by SRI integrity hash, not `package@version`.**
  Files: `src/cache/index.ts`, `src/registry.ts` (expose `dist.integrity`), `src/engine.ts`.
  Gap: a version string is mutable in principle and not globally dedup-able; the
  tarball's `dist.integrity` (`sha512-...`) is the true content address, valid
  forever and shareable across all users. Effort: M.
  Verify: two installs of the same bytes hit one cache entry; changing bytes
  changes the key. Add a test asserting key = integrity.

- [ ] **Verify tarball integrity before analysis (`ssri`).**
  Files: `src/diff.ts` (`fetchTarball`), `package.json` (add `ssri`).
  Gap: we extract tarballs without checking they match `dist.integrity` — a MITM
  or registry-swap would go unnoticed. Effort: S.
  Verify: corrupt a fixture tarball → integrity check throws; matching tarball passes.

- [ ] **Embed the OSV `MAL-` + OpenSSF malicious-packages blocklist for hard-blocks.**
  Files: new `src/blocklist/`, wire into `src/engine.ts` before heuristics.
  Gap: known-malicious `package@version` should hard-block instantly, no analysis.
  Data: OSV npm `all.zip` (filter `MAL-` IDs) + `ossf/malicious-packages` OSV JSON,
  refreshed snapshot shipped with the CLI. Match name-level when range is `"0"`.
  Effort: M. Verify: a seeded `MAL-` package → BLOCK with `known_malware` flag,
  offline.

## P1 — Detection depth (mostly extends `src/heuristics/`)

- [ ] **Upgrade typosquat to Damerau-Levenshtein + BK-tree over a top-10k list.**
  Files: `src/heuristics/nameDistance.ts`.
  Gap: current list is a ~20-name seed and OSA distance; a BK-tree over the real
  top-10k (npm-rank/all-the-package-names dump) with distance cap ≤2 is fast
  (~10ms) and far higher coverage. Add homoglyph normalization + delimiter/scope
  variants. Effort: M. Verify: `lodahs`→`lodash` still flags; add homoglyph and
  delimiter test cases; false-positive guard (require a 2nd signal) stays.

- [ ] **Provenance / maintainer downgrade detection.**
  Files: `src/registry.ts` (read signatures/attestations), `src/heuristics/index.ts`,
  optional `src/enrich/` (deps.dev provenance).
  Gap: the axios tell — prior versions published via CI/OIDC with SLSA provenance,
  new version via bare token with none, or maintainer email changed. Effort: M.
  Verify: fixture where prev has provenance and new doesn't → `provenance_downgrade`
  flag raises score.

- [ ] **Manifest-vs-repository mismatch + direct-URL-dependency + release-age signals.**
  Files: `src/heuristics/index.ts`, `src/registry.ts` (packument `time`).
  Gap: GuardDog-style `npm_metadata_mismatch`, `direct_url_dependency`, and a
  `min-release-age` (published <7d / <24h) contributing signal. Effort: S–M.
  Verify: fixtures per signal; release-age only escalates alongside an action signal.

- [ ] **AST-based script/source scan (replace remaining regex with acorn/babel).**
  Files: `src/heuristics/scriptScan.ts` (already AST for JS; extend coverage).
  Gap: capability+threat correlation (network sink + suspicious domain in same
  file scores higher) to cut false positives, per GuardDog v3. Effort: M.
  Verify: co-occurrence test scores higher than either signal alone.

## P2 — Demo + agent wedge

- [ ] **Add slopsquat detection (name absent from registry / brand-new + zero installs).**
  Files: `src/heuristics/index.ts`, `src/engine.ts` (registry existence check).
  Gap: hallucinated names have no typo distance; block `npx` of a nonexistent or
  brand-new near-zero-download name. Effort: S. Verify: nonexistent name → BLOCK
  with `slopsquat` flag.

- [ ] **Demo fixtures: `react-codeshift` slopsquat + axios-style malicious diff.**
  Files: `test/fixtures.ts`, `docs/DEMO.md`.
  Gap: the two headline demo beats need reliable local fixtures (no live malware).
  Effort: S. Verify: fixture tests assert BLOCK with expected flags.

- [ ] **Structured JSON verdict hardening for agents.**
  Files: `src/cli/index.ts` (`--json`), `src/types.ts`.
  Gap: ensure `verdict` (allow/warn/block), `categories`, `evidence[]`, `integrity`,
  `analyzer_version` are all present and stable for a Codex agent to gate on.
  Effort: S. Verify: `bnpx <pkg> --json` schema snapshot test.

## P3 — Post-hackathon / roadmap

- [ ] Hosted shared verdict cache service (first paid feature).
- [ ] Registry firehose worker for proactive scoring (PRD §8).
- [ ] Reachability-aware `warden audit`.
- [ ] Codex execpolicy adapter + Cursor/Gemini adapters.
- [ ] Rust port of hot paths (hashing, entropy, BK-tree, AST scan).

---

## Assumptions

- Priorities assume the near-term goal is a stronger hackathon demo + a credible
  path to the paid team tier, per the research report. Reorder if the goal shifts.
- The Ocally agent-harness study referenced in the prior prompt is a separate
  project not present in this repo; this tracker covers Warden only.
