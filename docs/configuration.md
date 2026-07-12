# Configuration

Warden is zero-config by default; everything below is optional.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Enables LLM-written explanations. Without it, verdicts use deterministic templates — detection is unaffected. |
| `WARDEN_LLM_MODEL` | `claude-haiku-4-5` | Model for the explanation call. |
| `WARDEN_LLM_BASE` | `https://api.anthropic.com` | API base URL (proxies, tests). |
| `WARDEN_CACHE_DIR` | `~/.warden-cache` | Verdict cache directory. |
| `WARDEN_REGISTRY` | `https://registry.npmjs.org` | Registry base URL (private registries, the wnpm mini-registry in tests). |
| `WARDEN_DOWNLOADS` | `https://api.npmjs.org/downloads/point/last-week` | Downloads-stats base URL. |
| `WARDEN_DEBUG` | unset | Prints the LLM-call count per run on stderr (the cache-hit metric). |

All URLs are read at call time, not process start, so tests and long-lived
processes can flip them per request.

## LLM cost model

The model is only invoked when a verdict escalates to MEDIUM/HIGH **and** a
key is present, receives only the compact signal JSON (never file contents),
and its output can only escalate the recommendation, never lower it. LOW
packages — the overwhelming majority — never cost a token. Combined with the
per-`name@version` cache, the marginal cost of a repeat install is zero.

## Cache behavior

- Key: `name@version` (immutable on npm).
- Store: one JSON file per verdict under `WARDEN_CACHE_DIR`, SHA-1-hashed
  filenames (scoped names are filesystem-safe).
- Reads mark `"cached": true`; there is no TTL because published versions
  cannot change. Bump `engine_version`/wipe the directory to re-score after
  heuristic changes.
- `checkPackage(spec, { noCache: true })` bypasses it programmatically.

## Failure-mode configuration (fixed, by design)

- Downloads/enrichment failures degrade silently (signals omitted).
- Tarball failures degrade to metadata-only analysis (script signals kept).
- Registry failures are loud: `warden check` exits 2; the agent hook allows
  the command (fail-safe) — see [agents.md](agents.md).
