# Warden Intent demo

A three-minute demo of `warden intent` — verifying that an agent's diff actually does what the prompt asked. The seeded repo contains four failure classes at once:

- one **delivered** set of changes (rate limiting, exponential 429 backoff, empty-response guard, configurable rate)
- one **dropped** requirement ("log every rate-limited request" — never implemented)
- one **scope-creep** rewrite (`pagination.ts`, rewritten cursor-style, nobody asked)
- one **hallucinated API** (`client.throttle(...)` — axios instances have no `throttle`)

## Run it

Needs `warden` on your `PATH` (`sh install.sh`) — or run the commands below via `./dist/warden` from the repo root after `bun run build`.

```sh
sh demo/intent/setup.sh
cd /tmp/warden-intent-demo
export WNPM_LLM_PROVIDER=claude   # zero keys — runs on your claude cli subscription
                                  # or: export WNPM_LLM_PROVIDER=codex (codex cli)
                                  # HTTP fallback: GROQ_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY

warden intent check            # prompt read from .warden/prompt.txt
```

Expected shape:

```
VERDICT: 5 ✅ · 1 ❌ · 1 ⚠️ · 1 🚨

  ✅ Add rate limiting to the API client          [api-client.ts:…]
  ✅ Preserve existing retry logic                 [no change touches it]
  ✅ Implement exponential backoff for HTTP 429s   [api-client.ts:…]
  ✅ Handle empty HTTP responses gracefully        [api-client.ts:…]
  ✅ Make rate limiting parameters configurable    [api-client.ts:…, config.ts:…]
  ❌ DROPPED: Log all rate-limited requests        [no matching change found]
  ⚠️ SCOPE CREEP: pagination.ts — 50+ lines changed, never requested
  🚨 HALLUCINATED: axios.instance.throttle         [api-client.ts:27]
     axios instance has no member 'throttle'. Known: get, post, put, delete, …
```

Exit code 20 — the same contract as `warden check`: 0 allow · 10 warn · 20 block · 30 error.

## Piece by piece

```sh
warden intent extract --prompt "$(cat .warden/prompt.txt)"   # claims ledger only (1 LLM call)
warden intent diff                                           # deterministic hunk classification (0 tokens)
warden intent symbols                                        # deterministic hallucination proof (0 tokens)
bun test ./rate-limit.test.ts                                  # pre-baked micro-test for the backoff claim
```

## Both senses in one pass

```sh
warden ci --reporter agent     # dependency vetting + intent verification, merged verdict
```

The prompt is picked up from `.warden/prompt.txt` (or pass `--intent-prompt "<text>"`). The agent reporter envelope gains an `intent` key; exit code is the max of both passes.

## Notes

- The hallucination check is deterministic: curated signature db first, then static export extraction from `node_modules` (never executes the package). Ask for any installed package — it answers.
- Claim extraction and leftover matching are the only LLM calls (2 per run, summaries only, never the raw diff). The two primary backends are zero-key CLI providers on your own subscription: `WNPM_LLM_PROVIDER=claude` shells out to the `claude` CLI (haiku by default) and `WNPM_LLM_PROVIDER=codex` shells out to `codex exec` (`WNPM_CLAUDE_BIN` / `WNPM_CODEX_BIN` override the binary). An HTTP fallback still works if you set `OPENAI_API_KEY`, `GROQ_API_KEY`, or `OLLAMA_API_KEY`. Model override via `WNPM_LLM_MODEL`. Note: the CLI providers have no temperature control, so borderline verdicts can reword between runs; the HTTP providers run at temperature 0 if you need reproducible output.
