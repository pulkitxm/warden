# Coding-agent integration (Claude Code)

Warden's differentiating surface: coding agents run `npm install` / `npx`
autonomously, often straight out of skill files nobody reviewed. Warden gives
the agent a verdict to reason over — and a hook that holds even when the agent
is being prompt-injected.

Everything ships in [`adapters/claude-code/`](../adapters/claude-code/):

```
adapters/claude-code/
├── README.md        install + verification + the security-review comparison
├── settings.json    PreToolUse hook config (merge into .claude/settings.json)
└── skill/SKILL.md   the skill (copy to .claude/skills/warden/)
```

## Layer 1 — the PreToolUse hook (enforcement)

`settings.json` wires `warden hook` onto every `Bash` tool call. The hook:

1. Reads the PreToolUse event JSON on stdin.
2. Extracts package specs from the command via
   [`src/adapters/parseCommand.ts`](../src/adapters/parseCommand.ts). It
   understands `npm|pnpm|yarn|bun` × `install|i|add`, `npx`/`bunx`,
   `pnpm dlx`/`yarn dlx`, compound commands (`&&`, `;`, `|`, `||`), quoted
   arguments, npm aliases (`safe@npm:evil`), and sees through leading
   env-assignments and wrappers (`sudo`, `env`, `nice`, `nohup`, `command`,
   `time`).
3. Vets every spec through the same engine as the CLI.
4. On a HIGH-risk package, prints a deny decision:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Warden blocked a HIGH-risk package: ..."
  }
}
```

The reason tells the agent to pick a safe alternative or ask the user — it
deliberately offers no self-service override, so a prompt-injected agent
cannot talk its way past it.

**Fail-safe:** malformed events, unparseable commands, and unresolvable
packages all allow the command (exit 0, no output). Warden never blocks work
because of its own failure — which also means every parser gap is a bypass;
the honest list of remaining gaps is in the
[adapter README](../adapters/claude-code/README.md#review-findings-before-vs-now).

## Layer 2 — the skill (interpretation)

`skill/SKILL.md` teaches the agent to run `warden check <pkg> --json` *before
proposing* a package and to act on the result: proceed on `allow`, surface
evidence and ask the user on `confirm_with_human`, refuse and suggest the
correctly-spelled package on `block`. The skill catches what the hook
deliberately does not (MEDIUM verdicts) and avoids wasted denied attempts.

## Why both layers

| | Hook | Skill |
|---|---|---|
| Enforced when the model ignores instructions | ✅ | ❌ |
| Holds under prompt injection | ✅ | ❌ |
| Handles MEDIUM (“ask the human”) gracefully | ❌ denies only HIGH | ✅ |
| Prevents proposing a bad package at all | ❌ reacts | ✅ proactive |

## Threats this was designed against

- **Slopsquatting** — an LLM hallucinates a plausible package name; an
  attacker registers it. The verdict flags typosquats/nonexistence before exec.
- **Hijacked releases** — a popular package's new version suddenly adds a
  postinstall (the diff-against-previous catches exactly this delta).
- **Agent-config implants** — packages shipping or writing `.claude/`,
  `.codex/`, `AGENTS.md` payloads score a dedicated `writes_agent_config`
  signal (weight 4), because that is how an attacker turns one install into
  persistent agent compromise.
