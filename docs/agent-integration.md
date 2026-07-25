# Agent integration

An agent that is merely told to use Warden can ignore the instruction. An agent whose commands are intercepted can be launched from somewhere the shim does not cover. The answer is not one perfect layer, it is three, and being explicit about which of them a given agent actually supports.

| Layer | What it does | What defeats it |
| --- | --- | --- |
| Guidance | An instruction file and a skill teach the agent to plan a dependency change before running it | The agent ignores it |
| Interception | A pre-command hook, or the PATH shim, mediates the package-manager command as it runs | An absolute path, a container, a remote runner |
| Verification | `warden ci --require-transaction-receipt` fails a pull request whose graph changed without a valid receipt | Nothing the agent can do locally |

## Capability model

Adapters declare capabilities rather than a launch command. Warden does not claim identical integration for every agent it knows how to start.

| Agent | Instruction file | Skill | Pre-command hook | Post-change hook | MCP | Managed settings |
| --- | --- | --- | --- | --- | --- | --- |
| claude | yes | yes | yes | yes | yes | yes |
| codex | yes | yes | yes | no | yes | yes |
| cursor | yes | no | no | no | yes | no |
| gemini | yes | no | no | no | yes | no |
| opencode | yes | no | no | no | yes | no |
| copilot | yes | no | no | no | no | no |
| aider | yes | no | no | no | no | no |

Every capability an agent lacks has a documented fallback, and `warden agent setup` prints it:

```
Not supported by this agent
  skill                guidance only; an agent can ignore it
  pre-command-hook     the PATH shim mediates the command instead
  post-change-hook     warden ci verifies the receipt instead
  mcp                  the agent calls the CLI and parses its JSON instead
```

## Setup

```sh
warden agent doctor
warden agent setup claude --yes
warden agent setup --all
```

Setup plans before it writes. It appends to an existing instruction file rather than overwriting it, and stamps `<!-- warden-adapter-version: ... -->` so a second run is a no-op.

Hook and MCP configuration files are never rewritten automatically. Those files carry settings Warden does not own; the command names the file and what to merge, and leaves the merge to you.

## MCP

```sh
warden agent mcp --json
```

The tool manifest is generated from the same command registry that produces the CLI help and the shell completions, so the MCP surface cannot drift from the binary. Flags become typed inputs, positional arguments become an `args` array, `--json` is always appended, and every tool documents its exit-code contract.

The surface is read-only. `plan`, `explain`, `compare`, `history`, `check`, `coverage`, `policy`, `scripts`, `verify`, `detect`, and `ci` are exposed. `apply`, `approve-script`, `init`, `config`, `uninstall`, `doctor`, and `fix` are not, and the manifest names each exclusion with its reason: they change the project or the trust configuration, and a human runs those.

## The skill

The installed skill states the loop in the terms an agent needs:

1. Plan with `warden plan --json`.
2. `ALLOW` proceeds, `BLOCK` does not install.
3. `NEEDS_APPROVAL` means report the exact package and hook to the human and ask. Do not approve on the human's behalf.
4. Apply with `warden apply <plan-id>`.
5. Parse the JSON and the exit code, never the human text.
