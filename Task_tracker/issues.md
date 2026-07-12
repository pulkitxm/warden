# Warden — Real-World Test Findings

Tested the actual CLI (`wnpx <pkg> --json`) against the **live npm registry**
(registry.npmjs.org), not the mini-registry, on 2026-07-12. Every row below is a
real command with real output. Severities reflect how badly each hurts real use
and the demo.

## Test matrix (real packages, real registry)

```
CLEAN POPULAR
  react            ALLOW  0    []
  express          WARN   45   [exfiltration, metadata_anomaly]        <-- FP
  lodash           WARN   29   [obfuscation]                            <-- FP (noisy)
  chalk            ALLOW  0    []
  typescript       WARN   85   [obfuscation, install_script, metadata]  <-- FP, near-block

LEGIT INSTALL SCRIPTS / NATIVE
  esbuild          BLOCK  100  [exfiltration, install_script]           <-- FALSE BLOCK
  sharp            ALLOW  0    []
  node-gyp         ALLOW  0    []
  bcrypt           WARN   25   [install_script]                          ok
  core-js          ALLOW  0    []

MINIFIED / BUNDLED
  react-dom        WARN   58   [obfuscation]                            <-- FP (noisy)
  next             BLOCK  100  [exfiltration, obfuscation, install...]  <-- FALSE BLOCK
  three            BLOCK  69   [exfiltration, obfuscation, metadata]    <-- FALSE BLOCK

SCOPED (all correct)
  @types/node      ALLOW  0    []
  @babel/core      ALLOW  0    []
  @typescript-eslint/parser  ALLOW 0 []

TYPOSQUAT / SLOPSQUAT
  lodahs           BLOCK  60   [typosquat, metadata]                     correct
  expresss         BLOCK  60   [typosquat, metadata]                     correct
  react-dom-router BLOCK  90   [slopsquat]                               correct (nonexistent)
  totally-not-real-pkg-xyz123  BLOCK 90 [slopsquat]                      correct
  react-codeshift  ALLOW  0    []                                        <-- DEMO BREAKER

VERSION RESOLUTION
  chalk@5.6.1      ALLOW  0    v=5.6.2   <-- WRONG VERSION returned; blocklist missed
  express@4.0.0    BLOCK  100  [exfiltration]                            <-- FALSE BLOCK
  left-pad@1.3.0   ALLOW  10   [metadata]                                ok

DEPRECATED
  request          BLOCK  100  [exfiltration, metadata]                  <-- FALSE BLOCK

LATENCY: axios cold = 1.64s wall, 139 MB RSS (packument + downloads + 2 tarballs)
```

---

## Issues, by severity

### I1 (CRITICAL) — Network/env capability is scored as "exfiltration", causing false blocks on real packages
**Evidence:** `esbuild`, `next`, `three` **BLOCK**; `express`, `request`, `express@4.0.0`, `typescript` warn/near-block, all tagged `exfiltration`.
**Root cause:** `packages/heuristics/src/scan.ts` flags `require('http'|'https'|'net')`, `fetch(`, and `process.env` reads as network/exfil findings. These are ubiquitous in legitimate code (every HTTP client, every server framework, every native installer reading proxy env). `packages/score` then treats the env+network "exfil-shape" as high-confidence INTENT that blocks when corroborated by any second action signal (an install script, obfuscation) — and the intent path **bypasses the established-package suppression**. So esbuild's `install.js` (reads proxy env + https-downloads its binary) and next's minified bundle (env + fetch) look identical to malware.
**Why the unit corpus missed it:** the synthetic benign fixtures never combined env+network+install-script the way real packages do.
**Impact:** unusable on real backend/build packages; the FP corpus claim ("won't cry wolf on your build tools") is currently false against the real world.

### I2 (CRITICAL) — Missing exact version silently falls back to `latest`
**Evidence:** `wnpx chalk@5.6.1 --json` returned `verdict: allow, version: 5.6.2`. The requested (unpublished, blocklisted) 5.6.1 was silently swapped for 5.6.2, so the blocklist entry for chalk@5.6.1 never matched.
**Root cause:** `packages/registry/src/index.ts resolvePackage` — when `pack.versions[resolved]` is absent it falls back to `tags.latest`. For a security tool this is dangerous: you ask about version X and get a verdict about version Y.
**Impact:** blocklist and version-specific analysis can be bypassed by requesting a removed version; verdicts can describe the wrong bytes.

### I3 (HIGH) — Slopsquat detection is defeated by defensive registration
**Evidence:** `react-codeshift` (the flagship demo name) now **ALLOWs** — someone defensively registered it, so `existsOnRegistry` is true and the only slopsquat signal ("does not exist") never fires. `react-dom-router` (truly nonexistent) correctly blocks.
**Root cause:** `ruleNameSimilarity` treats slopsquat as "name absent from registry" only. Real hallucinated names get claimed (by attackers or defenders); nonexistence is a weak, transient signal.
**Impact:** the live demo's headline beat fails against the real registry; slopsquat coverage is narrow. (The mini-registry demo still works because it 404s the name.)

### I4 (HIGH) — Obfuscation fires on legitimately minified dist bundles
**Evidence:** `typescript` 85, `react-dom` 58, `next`/`three` contribute obfuscation. Real published packages ship minified bundles that trip the long-line/entropy/blob checks.
**Root cause:** `obfuscationScore` treats minification as obfuscation. Only the establishment guard keeps these to WARN — remove it and they'd block.
**Impact:** high baseline noise; every bundler/framework warns. Combined with I1 it produces false blocks.

### I5 (MEDIUM) — Inconsistent handling of native/install-script packages
**Evidence:** `esbuild` BLOCK but `sharp`, `node-gyp`, `core-js` ALLOW — same category of package, wildly different verdicts. Depends on whether the installer file happened to be in the scanned set and whether it reads env.
**Impact:** unpredictable; erodes trust. The rules aren't native-module-aware (no allowlist for binary-host downloads).

### I6 (MEDIUM) — LLM path never exercised live
**Evidence:** no `OPENAI_API_KEY` in the test env; every verdict used the template fallback. The OpenAI call, JSON parse, and latency-in-path are unverified against the real API.
**Impact:** unknown behavior/latency when the key is present; possible stdout-contract risk if the SDK/path logs.

### I7 (MEDIUM) — Latency and no concurrency for trees
**Evidence:** 1.64s cold for a single package (axios: packument + downloads + 2 tarball fetches). `wnpm install` checks targets **sequentially**, so an N-dependency install is ~N x that with no caching across a fresh run.
**Impact:** a real `wnpm install` on a nontrivial tree would be slow; needs concurrency + the shared/persistent cache actually populated.

### I8 (LOW) — `wnpm install` shells to `npm`, not the wrapped resolver
**Evidence:** `apps/cli/src/wnpm.ts` runs `npm install --ignore-scripts`. The concept is "wrap pnpm/Bun"; using npm is inconsistent and assumes npm is present.
**Impact:** minor, but off-message and an extra dependency assumption.

### I9 (LOW) — Verdict "version" display shows 0.0.0 for the slopsquat/no-version path
**Evidence:** nonexistent names report `version: 0.0.0`. Cosmetic but confusing in JSON consumers.

### I10 (LOW) — Depends on api.npmjs.org downloads endpoint being reachable
**Evidence:** `weeklyDownloads` (and thus the establishment guard, which is currently load-bearing against I1/I4) silently becomes undefined if the downloads API is slow/unreachable, flipping established→false and making false blocks *more* likely.
**Impact:** the one thing protecting against false blocks (establishment) is best-effort and fails open in the wrong direction.

---

## What works well (keep)

- Scoped-package handling is correct (`@types/node`, `@babel/core`, `@typescript-eslint/parser` all clean).
- True typosquats (`lodahs`, `expresss`) and truly-nonexistent names block correctly.
- `--json` stdout purity holds; exit codes are correct.
- The integrity-keyed cache and blocklist mechanics are sound (when the right version is resolved — see I2).
- Cold single-package latency (~1.6s) is acceptable for the `wnpx` use case.

## Assumptions

- "Real-world use" interpreted as: a developer or agent running `wnpm`/`wnpx`
  against the public npm registry on real package names. Tested that path directly.
- No `OPENAI_API_KEY` was available, so the LLM path is tested only via fallback.
