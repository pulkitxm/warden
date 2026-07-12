# Warden — Vulnerability Suite: Failure Analysis

Run: 73 cases (25 malicious, 48 benign), no LLM. Full log in `vuln-test-results.md`.

## Scorecard

```
                 predicted BLOCK   predicted not-block
malicious (P)         TP=15             FN=10
benign    (N)         FP=2              TN=46
```

- **Strict recall (blocked): 60%** · **Lenient recall (block OR warn): 92%**
- Precision: 88% · Specificity: 96% · F1: 0.71

Read: the engine *flags* 92% of malicious cases but only *blocks* 60% — most
misses are detected-but-only-WARNed. The blocking policy is too conservative for
the lifecycle-script attack class. Both FPs are a robustness bug, not a heuristic
one (see FP section).

## False negatives (misses) — grouped by root cause

### Cluster A — lifecycle script + suspicious sink only WARNs (7 misses)
`curl-pipe-bash`, `base64-eval-loader`, `source-code-leak`, `cloud-imds-theft`,
`reverse-shell`, `dependency-confusion`, `fake-native-download` — all scored
90–100 (fully detected) but did not block, because no rule promotes
"install/preinstall/postinstall script + [public raw-IP sink | curl|bash |
base64→eval | net.connect]" to BLOCK. Today only env+raw-IP (exfil-shape),
obfuscation+exec-sink, name attacks, provenance/maintainer, and blocklist block.
- **Fix (highest value, low effort):** add a block rule — a lifecycle script
  combined with any exfiltration or exec-sink action signal blocks. A postinstall
  that curls-to-bash, opens a socket to a hardcoded public IP, or decode-then-
  evals is almost never legitimate. Keep a binary-host allowlist so genuine
  native installers (download from github/npm/CDN *hostnames*, not raw IPs) stay
  clear. Projected: flips ~6–7 of these, strict recall 60% → ~88%.

### Cluster B — techniques not modeled at all
- **Cloud IMDS theft:** `169.254.169.254` is link-local, deliberately excluded
  from the raw-IP check, so the metadata fetch isn't a signal. Fix: treat known
  metadata endpoints (`169.254.169.254`, `metadata.google.internal`,
  `100.100.100.200`) as high-signal sinks despite being link-local.
- **fs-based source/secret exfil:** reading the project tree / `.git` /
  `~/.npmrc` / `~/.ssh` / `~/.aws` / `.env` is not detected (only the network
  leg is). Fix: flag fs reads of sensitive paths in scripts, especially paired
  with any network egress.
- **Destructive fs (protestware):** `fs.rmSync`/`unlink` of home/cwd in a
  lifecycle script isn't detected. Fix: flag destructive fs ops in lifecycle scripts.
- **Dependency confusion:** an internal-looking scoped name published publicly
  with an anomalously high version (`@acme-corp/internal-config@99.0.0`) isn't
  modeled. Fix: heuristic for scope + suspicious-high version + recent + public.

### Cluster C — name-attack coverage holes (2 misses, ALLOW score 0)
- `reqeust` (typosquat of **request**) → ALLOW: `request` is not in the 30-name
  seed list, so no near-match. **Fix: ship the real top-10k popular-name list**
  (already planned as B2/P1.1). This is the single biggest name-coverage lever.
- `@typescript_eslinter/eslint` (scoped slopsquat) → ALLOW: the scope is stripped
  and the bare part `eslint` equals a real package, so it looks legit. **Fix:
  scope-aware matching** — if the unscoped part matches a popular package but the
  scope is not that package's real owner, flag scoped impersonation.

## False positives (false alarms) — both are one robustness bug

`d3` and `next` blocked in-suite, but **both correctly WARN when run standalone**
(d3: 12.6M weekly, next: 44.7M weekly, established=true). Under the suite's
concurrency the proxied downloads-API call timed out → `weeklyDownloads`
undefined → `established=false` → the capability-block suppression was lost →
false block. This is **issue I10 (establishment fail-open)**: the sole guard
against capability false-positives depends on a best-effort API call that fails
open in the FP-increasing direction under load / rate-limit / outage.
- **Fix (P3.1):** persist/cache download counts by name; bundle a top-N
  established-names list as a fallback so "downloads unknown" does not flip a
  known-popular package to "not established"; treat unknown-establishment
  conservatively. A security tool must not false-block more when the network degrades.

## Recommended improvement order (projected effect)

| # | Fix | Addresses | Effort | Projected |
|---|-----|-----------|--------|-----------|
| 1 | Block rule: lifecycle script + suspicious sink (raw-IP/curl-bash/base64-eval/socket) + native-host allowlist | Cluster A (7 FN) | S | strict recall 60% → ~88% |
| 2 | Establishment robustness: cache downloads + bundled top-N fallback, no fail-open | FP d3/next (I10) | S–M | specificity 96% → ~100% |
| 3 | Real top-10k name list + scope-aware matching | Cluster C (2 FN) | M | recall → ~96% |
| 4 | New detectors: IMDS endpoints, fs-exfil of sensitive paths, destructive fs, dependency confusion | Cluster B (misses + future) | M–L | closes the modeling gaps |

After 1–3, projected strict recall ~96% with specificity ~100% on this suite —
without weakening the false-positive discipline (the block rule keys on
lifecycle+sink and raw *public* IPs, which the benign corpus does not trip).

## Notes / honesty

- Malicious cases are faithful fixtures, not live malware. Real attacks are
  messier; treat these as lower bounds on detectability.
- Lenient recall (92%) means an agent/human gating on WARN (not just BLOCK)
  already avoids most of these — but the product's promise is blocking, so the
  strict number is the one to move.
- The suite is re-runnable: `bun scripts/vuln-suite.ts` (no LLM, ~1–2 min).
