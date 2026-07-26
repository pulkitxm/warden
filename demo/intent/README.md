# Warden Intent demo

A three-minute demo of `warden intent`, verifying that an agent's diff actually does what the prompt asked. The seeded repo contains four failure classes at once:

- one **delivered** set of changes (rate limiting, exponential 429 backoff, empty-response guard, configurable rate)
- one **dropped** requirement ("log every rate-limited request", never implemented)
- one **scope-creep** rewrite (`pagination.ts`, rewritten cursor-style, nobody asked)
- one **hallucinated API** (`client.throttle(...)`, axios instances have no `throttle`)

Two things it deliberately does not contain, so you can see the quiet path: no undeclared import, and no
package name that fails to resolve.

## Run it

Needs `warden` on your `PATH` (`sh web/public/install.sh`), or run the commands below via `./dist/warden` from the repo root after `bun run build`.

```sh
sh demo/intent/setup.sh
cd /tmp/warden-intent-demo
export WNPM_LLM_PROVIDER=claude   # zero keys, runs on your claude cli subscription
                                  # or: export WNPM_LLM_PROVIDER=codex (codex cli)
                                  # HTTP fallback: GROQ_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY

warden intent check            # prompt read from .warden/prompt.txt
```

Expected shape:

```
VERDICT: 5 ✅ · 1 ❌ · 1 ⚠️ · 1 🚨

  ✅ Add rate limiting mechanism to the API client                    [api-client.ts:1-39]
  ✅ Preserve existing retry logic in the implementation              [no change names it]
  ✅ Implement exponential backoff strategy for HTTP 429 responses    [api-client.ts:1-39, rate-limit.test.ts:1-9]
  ✅ Handle and appropriately respond to empty API responses          [api-client.ts:1-39]
  ✅ Make the rate limit value configurable via options               [api-client.ts:1-39, config.ts:1-2]
  ❌ DROPPED: Log every request that is rate-limited or throttled     [no matching change found]
  ⚠️ SCOPE CREEP: pagination.ts, 55 lines changed, never requested    [pagination.ts:1-57]
  🚨 HALLUCINATED: axios.instance.throttle                           [api-client.ts:27]
     axios instance has no member 'throttle'. Known: get, post, put, delete, … (curated signature db)

  prompt-as-spec · merge-base 8d97a781f860 · llm calls: 2
```

The claim wording comes from the model, so it rewords between runs. The five counts, the dropped
requirement, the scope-creep hunk, the hallucinated member, and exit `20` do not.

Note what is deliberately **not** reported: `axios` is imported on an added line and is declared in
`package.json`, so the undeclared-import rule stays quiet. Delete the `axios` entry from
`package.json` and re-run to see it fire.

Exit code 20, the same contract as `warden check`: 0 allow · 10 warn · 20 block · 30 error.

## Piece by piece

```sh
warden intent extract --prompt "$(cat .warden/prompt.txt)"   # claims ledger only (1 LLM call)
warden intent diff                                           # deterministic hunk classification (0 tokens)
warden intent symbols                                        # deterministic hallucination proof (0 tokens)
warden intent check --offline                                # no registry lookup; the report says so
warden intent bench                                          # the accuracy corpus, offline, 0 tokens
bun test ./rate-limit.test.ts                                  # pre-baked micro-test for the backoff claim
```

Run `warden intent check` with every provider variable unset to see the degraded path: it still blocks on
the hallucinated `throttle` call, marks `claims_status` as `unverifiable`, and records in `notes` that
scope creep was not assessed because there were no claims to assess it against.

## Both senses in one pass

```sh
warden ci --reporter agent     # dependency vetting + intent verification, merged verdict
```

The prompt is picked up from `.warden/prompt.txt` (or pass `--intent-prompt "<text>"`). The agent reporter envelope gains an `intent` key; exit code is the max of both passes.

## Notes

- The hallucination check is deterministic: curated signature db first, then static export extraction from `node_modules` (never executes the package). Ask for any installed package, it answers.
- Claim extraction and leftover matching are the only LLM calls (2 per run, summaries only, never the raw diff). The two primary backends are zero-key CLI providers on your own subscription: `WNPM_LLM_PROVIDER=claude` shells out to the `claude` CLI (haiku by default) and `WNPM_LLM_PROVIDER=codex` shells out to `codex exec` (`WNPM_CLAUDE_BIN` / `WNPM_CODEX_BIN` override the binary). An HTTP fallback still works if you set `OPENAI_API_KEY`, `GROQ_API_KEY`, or `OLLAMA_API_KEY`. Model override via `WNPM_LLM_MODEL`. Note: the CLI providers have no temperature control, so borderline verdicts can reword between runs; the HTTP providers run at temperature 0 if you need reproducible output.
