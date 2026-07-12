# Warden — Claude Code adapter

Two pieces that make Warden work inside Claude Code:

1. **PreToolUse hook** (`settings.json`) — *enforcement*. Runs on every `Bash`
   tool call, extracts install/`npx` commands, and deterministically **denies**
   HIGH-risk packages before they execute. The model cannot skip it — this is
   the layer that holds even under prompt injection from a malicious skill file.
2. **Skill** (`skills/warden/SKILL.md`) — *interpretation*. Teaches the agent to
   run `warden check --json` before proposing a package and to act on the
   verdict (suggest the correct name on a typosquat, ask for confirmation on
   MEDIUM, refuse on HIGH).

They solve different halves: the hook is a security boundary; the skill makes
the agent use the verdict intelligently. Install both.

## Install

> The npm name `warden` is taken by an unrelated package — do **not**
> `npm install -g warden`. Install from this repo:

```sh
# 1. Put `warden` on PATH (from a clone of this repo)
bun install && bun run build && npm link

# 2. Add the hook — merge adapters/claude-code/settings.json into your
#    project .claude/settings.json (or user ~/.claude/settings.json)

# 3. Add the skill — copy the skill folder into your project
cp -r adapters/claude-code/skills/warden .claude/skills/warden
```

If you don't want `npm link`, replace `"warden hook"` in `settings.json`
with `"node /absolute/path/to/warden/dist/cli/index.js hook"`.

## Verify

Seed a HIGH verdict (see `docs/DEMO.md`), then ask the agent to install that
package; the hook returns a `deny` decision with a plain-English reason and the
agent self-corrects. Note that a mere typosquat usually scores MEDIUM
(`confirm_with_human`), which the hook deliberately does not deny — only HIGH
is blocked.

## Hook I/O contract

- **Input** (stdin): Claude Code's PreToolUse event JSON, including
  `tool_input.command`.
- **Output** (stdout): on a HIGH-risk package, a PreToolUse decision object with
  `permissionDecision: "deny"` and a `permissionDecisionReason`. Otherwise no
  output (the command proceeds).
- **Fail-safe**: any parse/resolve error allows the command — Warden never
  blocks work because of its own failure to analyze. Fail-safe cuts both ways:
  every parser gap is a silent bypass, which is why the gaps below are listed
  explicitly instead of assumed away.

## Review findings: before vs now

A security review of the hook path found several fail-open bypasses. Where they
stand:

| Problem found | Before | Now |
|---|---|---|
| `NODE_OPTIONS= npm i evil` / `sudo npm i evil` — any prefix token blinded the parser | allowed unvetted (critical bypass) | **fixed** — env-assignments and wrappers (`sudo`, `env`, `nice`, `nohup`, `command`, `time`) are stripped before matching |
| `npm i lodash@^4` — semver ranges could not resolve | resolve threw, hook failed open | **fixed** — ranges resolve via a built-in semver (`^`, `~`, wildcards, comparators, `\|\|`) |
| `npm i safe-name@npm:evil-pkg` — alias specs misparsed | alias never resolved, failed open | **fixed** — the engine unwraps `@npm:` aliases and vets the real package |
| Tarball fetch failure dropped all lifecycle-script signals | malicious postinstall could score LOW | **fixed** — engine degrades to registry-metadata scripts, so the postinstall delta survives |
| Deny reason suggested `warden check --allow-risky` as an override | agents looped retrying an override that cannot work | **fixed** — the reason now says to pick an alternative or ask the user |
| LLM could downgrade a HIGH verdict's `recommendation` to `allow` | agents keying on `recommendation` could run HIGH packages | **fixed** — the deterministic level is a floor; the model can only escalate |

Still open, by design or documented limitation:

- **Bare `npm install`** (no package argument) names nothing to vet; the hook
  allows it. Use `bnpm install`, which vets the direct dependencies instead.
- **Only HIGH is denied.** MEDIUM surfaces through the skill as
  `confirm_with_human`; the hook does not block it.
- **Transitive dependencies are not vetted** by the hook (it sees the command,
  not the resolved tree). `bnpm install` mitigates by re-enabling lifecycle
  scripts only for the vetted top-level packages.
- **Unknown shell constructs fail open** (subshells, `xargs`, `eval` strings).
  The hook is a strong seatbelt, not a sandbox.