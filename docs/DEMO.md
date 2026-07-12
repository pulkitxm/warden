# Warden — Demo Runbook

Four beats, mapping to the PRD success metrics. Run from the repo root after
`pnpm install && pnpm build`. Use a scratch cache so runs are reproducible:

```sh
export WARDEN_CACHE_DIR="$(mktemp -d)"
export WARDEN_DEBUG=1     # prints the LLM-call count per run
```

## 1. Detection works on real packages (M1)

```sh
# Clean, popular package → LOW, allowed (exit 0)
warden check express --no-enrich

# Real typosquat placeholder of lodash → MEDIUM, confirm-with-human
warden check lodahs --json --no-enrich
```

`lodahs` comes back with `flags: ["typosquat", "low_install_history"]` and
`recommendation: "confirm_with_human"`. Note the `low_install_history` signal
only counts because the typosquat action signal is present — a plain new package
would stay LOW. That weighting rule is the false-positive guard; the offline
tests (`pnpm test`) prove it against crafted malicious + clean fixtures.

## 2. Agent is blocked mid-loop and self-corrects (M2)

The Claude Code PreToolUse hook denies a HIGH-risk install before it runs. To
see the exact `deny` decision the agent receives, feed the hook a PreToolUse
event on stdin (here we pre-seed a HIGH verdict to stand in for a live malicious
release, which we don't want to actually fetch-and-run):

```sh
# Seed a HIGH verdict for a pinned version
node -e '
import("./dist/cache/index.js").then(async ({FileVerdictCache, cacheKey}) => {
  const c = new FileVerdictCache();
  await c.set(cacheKey("is-odd","3.0.1"), {
    package:"is-odd@3.0.1", risk_score:8.5, level:"HIGH",
    flags:["typosquat","new_postinstall","network_in_script"],
    evidence:["postinstall script added","outbound request to an unrecognized host"],
    explanation:"Likely malicious: a new postinstall script makes an outbound network request.",
    recommendation:"block", cached:false, engine_version:"0.1.0", llm_used:false,
  });
});'

# The hook sees the agent trying to run it and denies:
echo '{"tool_name":"Bash","tool_input":{"command":"cd app && npx is-odd@3.0.1"}}' \
  | warden hook
```

Output is a `permissionDecision: "deny"` object whose `permissionDecisionReason`
carries the plain-English verdict + flags — that string is what the agent reads
and self-corrects from.

For a live in-agent demo: install the adapter (`adapters/claude-code/`), then ask
Claude Code to `npx` a typosquatted name and watch the hook block it.

## 3. Second run costs zero LLM calls (M3)

```sh
warden check lodahs --no-enrich      # first run: cold
warden check lodahs --no-enrich      # second run: shows "(cached)"
```

Both runs print `llm calls this run: 0`. The verdict is cached per immutable
`package@version`, so repeat installs — by this user or any other — are a cache
lookup. This is the line to show judges: **marginal cost per install ≈ zero.**

## 4. Heuristics-only mode (M4)

Everything above runs with **no `ANTHROPIC_API_KEY` set** — the deterministic
engine produces correct block/allow verdicts on its own, and the explanation
falls back to a template. Set `ANTHROPIC_API_KEY` to upgrade the explanation to
a one-paragraph LLM verdict (only computed on MEDIUM/HIGH escalation).
