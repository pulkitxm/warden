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

Verdicts are cached in SQLite by npm's immutable `dist.integrity` value. The LLM sees only compact evidence, runs only for warn/block verdicts when `OPENAI_API_KEY` is set, and cannot change the deterministic verdict.

The offline mini-registry under `fixtures/` supplies benign and malicious packages to the integration tests and demo.
