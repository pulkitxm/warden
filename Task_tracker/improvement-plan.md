# Warden — Improvement Plan (post real-world test)

The real-registry test (`Task_tracker/issues.md`) showed the engine is
mechanically sound but **mis-calibrated**: it over-fires on the network/env/
minification capabilities that pervade real packages, and it has two correctness
bugs (version fallback, slopsquat-by-nonexistence). Fixing calibration without a
real-package measurement harness is guesswork, so that harness is step 0.

## Priority table

| # | Fix | Issue | Impact | Effort | Files | Verify |
|---|-----|-------|--------|--------|-------|--------|
| P0.1 | **Real benign corpus harness** — vendor real tarballs (`bun pm pack`) of esbuild, next, three, express, request, typescript, react-dom, sharp, bcrypt, core-js; run them through analyze+score; assert **none block**. This is the ruler for every calibration change. | I1,I4,I5 | Turns "looks fine" into a measured gate | M | new `fixtures/benign-real/`, `packages/score/test/real-corpus.test.ts` | the new suite is red now, green after P1 |
| P1.1 | **Stop scoring bare network/env as exfiltration.** `require('http'/'https'/'net')`, `fetch`, and lone `process.env` reads become informational (weight 0, non-action). Exfiltration requires correlation: env **serialization** (`JSON.stringify(process.env)`, wholesale dump) **plus** network to a **raw IP or hardcoded non-registry host**. | I1 | Removes the dominant false-block cause | M | `packages/heuristics/src/scan.ts`, `src/index.ts` (rule B) | express/request/next/esbuild no longer block; axios/shai-hulud fixtures still do |
| P1.2 | **Establishment suppression applies to the intent-corroboration path too**, except for hard tells (blocklist, typosquat, slopsquat, provenance-downgrade, maintainer-change). Capability correlations never block an established, non-recent package. | I1,I4 | Popular packages can't false-block via the intent path | S | `packages/score/src/index.ts` | esbuild/next/three -> warn, not block |
| P1.3 | **Diff-gate capability signals.** Only count obfuscation / new scripts / new network sinks that are **newly added or changed** in this version (we already diff — feed `isNewPackage`/added-vs-changed through to weighting). A stably-minified bundle that hasn't changed is not a signal. | I4 | Kills minification noise on established packages | M | `packages/heuristics`, `packages/diff` | typescript/react-dom drop to allow/low-warn |
| P2.1 | **Fix version fallback (correctness/security).** If an exact `name@version` is requested and that version does not exist, return a distinct "version not found" outcome — do **not** resolve to `latest`. Fall back to latest only when no version/tag was requested. | I2 | Closes blocklist/version-analysis bypass | S | `packages/registry/src/index.ts` | `wnpx chalk@5.6.1` reports 5.6.1-not-found (or blocklist if served), never a 5.6.2 verdict |
| P2.2 | **Harden slopsquat beyond non-existence.** Add: brand-new (age < 7d) + near-zero weekly downloads + name is a plausible conflation of two real packages (or edit-distance-far-but-plausible). Emit `slopsquat` (block) for nonexistent, `slopsquat`-warn for the brand-new-zero-download case. Ship a small curated hallucinated-name list for the demo so react-codeshift is covered even though it is now registered. | I3 | Restores the flagship coverage against the real registry | M | `packages/heuristics/src/index.ts`, new `packages/intel/data/hallucinated.json` | react-codeshift -> at least warn on the real registry; nonexistent -> block |
| P2.3 | **Native-module awareness.** Allowlist known binary-download hosts (github.com/releases, registry.npmjs.org, common CDNs); recognize node-gyp/prebuild/napi patterns so a native installer's https-download is expected, not exfil. | I1,I5 | Consistent verdicts for native packages | M | `packages/heuristics` | esbuild/sharp/bcrypt handled the same way (allow/low-warn) |
| P3.1 | **Establishment must not fail open.** Cache weekly-downloads; if unavailable, fall back to a conservative "treat as established if on a shipped top-N list" rather than "not established". | I10 | Removes the fail-in-the-wrong-direction risk | S | `packages/registry`, `packages/cache`, bundle top-N | downloads-API-down does not increase false blocks |
| P3.2 | **Parallelize `wnpm` checks + persist cache.** Check targets concurrently (bounded); use the on-disk cache across runs; pre-warm demo verdicts. | I7 | Makes real installs usable; demo network-off | M | `apps/cli/src/wnpm.ts`, `packages/cache` | N-dep install ~ one round-trip, not N |
| P3.3 | **Live LLM smoke test.** A key-gated test that hits OpenAI once, asserts a parsed summary and that stdout stays a single JSON object. | I6 | De-risks the key-present path | S | `packages/llm/test/live.test.ts` (skipped without key) | passes with a key set |
| P4.1 | Wrap Bun/pnpm instead of npm; fix the 0.0.0 version display. | I8,I9 | Consistency/polish | S | `apps/cli/src/wnpm.ts`, engine | `wnpm install` uses the detected PM; nonexistent shows requested version |

## Sequence (walking skeleton first)

1. **P0.1 — build the real benign corpus harness.** Land it red. Every later
   change is judged against it. Without this we are tuning blind (which is how
   the synthetic corpus passed while the real world failed).
2. **P1.1 + P1.2 + P1.3 — recalibrate.** Iterate until the real benign corpus is
   green AND the malicious corpus (lodahs/axios/chalk-style/react-codeshift/
   shai-hulud fixtures) still blocks for the right categories. This is the core
   of the fix and unblocks a truthful demo.
3. **P2.1 — version fallback.** Small, security-critical, independent.
4. **P2.2 + P2.3 — slopsquat robustness + native awareness.** Restores demo
   coverage and consistency.
5. **P3.x — establishment hardening, concurrency/cache, live LLM test.**
6. **P4.x — resolver wrap + polish.**

## Guardrail for the calibration work

Hold both corpora as a two-sided gate on every heuristic change:
- **Benign real corpus: zero blocks.** (Currently failing — esbuild/next/three.)
- **Malicious corpus: all block, right categories.** (Currently passing.)

A change that greens the benign corpus by weakening detection must not regress
the malicious corpus. Tune weights/correlations, not by removing rules.

## Honesty note for the demo (until P1/P2 land)

Right now the truthful demo runs against the **mini-registry** (offline
fixtures), where verdicts are correct and react-codeshift 404s to slopsquat.
Do **not** demo `wnpm install esbuild` / `next` against the real registry — they
false-block today. `wnpx lodahs` and the agent-sim beat are safe live.
