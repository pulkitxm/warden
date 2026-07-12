# CLI reference

Three binaries ship from this package (`npm link` after `bun run build`):

| Binary | Purpose |
|---|---|
| `warden` | full CLI: `check`, `npx`, `install`, `hook`, `help` |
| `bnpm` | alias for `warden install` — drop-in for `npm install` |
| `bnpx` | alias for `warden npx` — drop-in for `npx` |

Exit codes everywhere: `0` allowed/clean · `1` blocked (HIGH risk) · `2` usage
or analysis error.

## `warden check <pkg[@version]>... [--json] [--no-enrich] [--allow-risky]`

Scores one or more packages. Version may be omitted (`latest`), a dist-tag, an
exact version, or a semver range (`^4.17.0`, `1.x`, `>=2 <3`). npm aliases
(`alias@npm:real@1.0.0`) are unwrapped and the real package is vetted.

- Human mode prints a risk report with evidence bullets.
- `--json` prints the full verdict object (an **array** when multiple packages
  are given):

```json
{
  "package": "some-cli@2.1.0",
  "risk_score": 6.5,
  "level": "MEDIUM",
  "flags": ["new_postinstall", "network_in_script"],
  "evidence": ["postinstall script added (previous version had none)"],
  "explanation": "some-cli@2.1.0 warrants a human check: ...",
  "recommendation": "confirm_with_human",
  "cached": false,
  "engine_version": "0.1.0",
  "llm_used": false
}
```

- `--no-enrich` skips the OSV.dev / deps.dev network lookups.
- Exit is `1` if any package is HIGH, unless `--allow-risky`.

## `warden npx <pkg[@version]> [--json] [--allow-risky]`

Pre-run vetting for a package you are about to execute. `--json` emits the
compact agent shape (exactly these five fields):

```json
{
  "package": "some-cli@2.1.0",
  "risk_score": 8.5,
  "level": "HIGH",
  "flags": ["new_postinstall", "network_in_script"],
  "recommendation": "block"
}
```

Human mode refuses to proceed on HIGH without `--allow-risky`. (The MVP stops
at the verdict; it does not exec the package.)

## `warden install [pkgs...] [--allow-risky] [-- <pnpm args>]` (= `bnpm`)

Gated install:

1. Vets every named package — or, with no arguments, every direct dependency
   in `./package.json`.
2. Prints a grouped per-package report.
3. If anything is HIGH: blocks with exit `1` (override with `--allow-risky`).
4. Runs `pnpm install --ignore-scripts` (arguments after `--` pass through).
5. Re-enables lifecycle scripts **only for the vetted packages**
   (`pnpm rebuild <names>`) — unvetted transitive dependencies keep their
   scripts disabled.

`bnpm i foo`, `bnpm add foo`, and `bnpm foo` all map to `warden install foo`.

## `warden hook`

The Claude Code PreToolUse adapter — reads the hook event JSON on stdin and
emits a deny decision for HIGH-risk installs. See [agents.md](agents.md) for
the contract, the command shapes it understands, and its known gaps.

## `bnpx <pkg>` (= `warden npx`)

`bnpx cowsay`, `bnpx npx cowsay` both map to `warden npx cowsay`.
