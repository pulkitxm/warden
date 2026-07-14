# Warden Intent × Claude Code

Automatic intent verification for Claude Code sessions. Nobody pastes their prompt into a
verifier by hand — these two hooks do it:

- **UserPromptSubmit** → `capture-prompt.ts` appends every prompt you type to
  `.warden/prompt.txt` (reset when a new session starts, slash commands ignored).
- **Stop** → `verify-intent.ts` runs `warden intent check` whenever Claude finishes a turn
  that changed files. On a blocking verdict (dropped requirement or hallucinated API) it
  feeds the report back to Claude, which keeps working until the diff matches the prompt.

## Install into a project

```sh
mkdir -p .claude/hooks
cp <warden-repo>/demo/claude-code/hooks/*.ts .claude/hooks/
cp <warden-repo>/demo/claude-code/settings-example.json .claude/settings.json
echo ".warden/" >> .gitignore
```

If `.claude/settings.json` already exists, merge the `hooks` block instead of overwriting.

Requirements:

- `warden` on PATH (or set `WARDEN_BIN=/path/to/warden` in your environment)
- `bun` on PATH (runs the hook scripts)
- an LLM: with no API key configured, the hook auto-detects a CLI provider — it prefers the
  `claude` CLI (`WNPM_LLM_PROVIDER=claude`, haiku by default), then falls back to `codex`
  (`codex exec`) — so your existing Claude or Codex subscription pays, no key needed. To use
  an HTTP provider instead, set `GROQ_API_KEY`, `OLLAMA_API_KEY`, or `OPENAI_API_KEY` in a
  project-local gitignored `.env`; bun auto-loads it

Restart Claude Code (or run `/hooks`) after editing settings so the hooks register.

## What a session looks like

```
you   > add rate limiting to the api client and keep the retry logic
claude> *edits files, stops*
hook  > warden intent check → ❌ DROPPED: keep the retry logic
claude> *sees the verdict, restores retry.ts, stops again*
hook  > warden intent check → all ✅ → silence
```

## Behavior details

- **Verdict → action**: block (exit 20) → Claude is told to continue with the full report;
  warn (exit 10) → report attached as non-blocking context; allow → silence; infra errors
  (exit 30, missing binary, missing key) → silence, never breaks your session.
- **One forced continuation per stop**: when `stop_hook_active` is set, a still-failing
  verdict is attached as context instead of blocking again, so a genuinely impossible claim
  cannot loop the session.
- **No changes, no tokens**: the hook fingerprints the git diff (tracked + untracked,
  `.warden/` excluded) and skips verification when nothing changed since the last verified
  state — question-and-answer turns cost zero LLM calls.
- **Prompt ledger**: the whole session's prompts accumulate as one spec, matching the diff
  against the merge base. Edit `.warden/prompt.txt` if a stale requirement lingers.
- **Provider trade-off**: HTTP providers run at temperature 0 for reproducible verdicts;
  the `claude` CLI provider has no temperature control, so borderline claims can
  occasionally flip between partial and delivered across runs.
