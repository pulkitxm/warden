# Architecture

WNPM is one Bun package with two binaries and one verdict pipeline:

```text
package spec
  -> registry metadata
  -> blocklist and hallucinated-name checks
  -> integrity-keyed cache
  -> current and previous tarballs
  -> SRI verification and file diff
  -> deterministic heuristics and scoring
  -> optional explanation
  -> verdict
```

`src/engine.ts` owns the pipeline used by both CLIs. Supporting modules have one responsibility: registry access, tar parsing, integrity verification, diffing, heuristics, scoring, intelligence data, caching, schema, and explanation.

`wnpm doctor` builds on the same pipeline:

```text
project manifest and lockfile
  -> OSV advisories per dependency (src/vuln.ts)
  -> safe upgrade candidates (src/semver.ts, src/doctor/plan.ts)
  -> verdict-engine gate on every candidate (src/engine.ts)
  -> minimal and latest plans
  -> isolated-workspace verification: install + project test/typecheck/build (src/doctor/verify.ts)
  -> report, then applies exact pinned versions by default (--no-apply for report only)
```

The gate is the connective tissue: an advisory may name a fixed version, but the fix is only recommended if that release also clears the supply-chain verdict. Applied fixes are pinned to the exact version that passed verification so the installed state cannot drift from the verified state.

Verdicts are cached in SQLite by npm's immutable `dist.integrity` value. The LLM sees only compact evidence, runs only for warn/block verdicts when `OPENAI_API_KEY` is set, and cannot change the deterministic verdict.

The offline mini-registry under `fixtures/` supplies benign and malicious packages to the integration tests and demo.
