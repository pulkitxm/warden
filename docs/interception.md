# Interception: shims and reporting modes

How warden sits in front of npm, pnpm, yarn, and Bun without users changing a single habit.

Part of the [product plan](system-integration.md).

## PATH shims

Do not parse or rewrite commands in `.zshrc` functions or aliases; that breaks in scripts, CI, and non-interactive shells. Use the proven volta/rbenv pattern instead:

- `~/.warden/shims/` contains executables named `npm`, `pnpm`, `yarn`, `bun`, `npx`, `bunx`.
- Every shim first reads `~/.warden/config.json`; when `intercept` is off it execs the real binary immediately, zero vetting, zero output. Warden stays installed but dormant until re-enabled.
- Each shim inspects its argv:
  - install verbs (`install`, `i`, `add`, `update`, plus `npx`/`bunx`/`pnpm dlx` execution) run `warden check` on the requested specs first
  - block verdict aborts with warden's report; `--allow-risky` passes through
  - every other verb execs the real binary untouched, resolved by searching PATH minus the shim directory
- One guarded line in the shell rc: `export PATH="$HOME/.warden/shims:$HOME/.warden/bin:$PATH"`. Idempotent, easy to remove, works in every shell that reads the rc, and puts both the shims and the `warden` binary itself on PATH.

```
$ npm install express
Warden: vetting 1 package before install
  ALLOW express@5.1.0  clean
vetted; installing via npm with lifecycle scripts disabled...

added 64 packages in 2.1s
```

## The interception switch

`~/.warden/config.json`:

```json
{
  "mode": "brief",
  "managers": ["npm", "pnpm", "bun", "npx", "bunx"],
  "intercept": { "install": true, "exec": true }
}
```

- `managers` records the commands selected in the installer's manager picker; only those commands receive shims.
- `install` covers `npm/pnpm/yarn/bun install|add|i|update`; `exec` covers `npx`, `bunx`, `pnpm dlx`.
- `warden config intercept off` (or `install off`, `exec off`) flips it without touching shims or PATH; `on` restores it.
- This is user-level config only. A repo's `warden.config.json` can never turn interception on for someone who disabled it.

```
$ warden config intercept off
interception disabled; shims now pass every command straight through

$ npm install expres
added 1 package in 0.4s

$ warden config intercept on
interception enabled (install, exec)
```

## Reporting modes

The installer asks a two-option question (protect maps to `brief`, observe maps to `log`); all four modes are stored in `~/.warden/config.json`, overridable per run (`--mode=verbose`), editable via `warden config`:

- `verbose`: full verdict report on every intercepted command
- `brief`: one line per package, details only on warn or block
- `block`: no prompts, block verdicts abort silently with exit 20
- `log`: never abort, record verdicts to `~/.warden/log.jsonl` only

The same command under each mode. `npm install express expres`, one clean package, one typosquat:

`verbose`, full report for every package:

```
$ npm install express expres
Warden: vetting 2 packages before install

ALLOW  express@5.1.0  risk 4/100 · npm
  • 32M weekly downloads, 14 years of releases, provenance attested
  • no install scripts, no risk categories

  verdict: established package, no risk signals

BLOCK  expres@0.0.5  risk 92/100 · npm
  categories: typosquat, install-script
  • name is 1 edit away from "express" (32M weekly downloads)
  • postinstall script present; express has none
  • published 9 days ago by a maintainer with no other packages

  verdict: probable typosquat of express with an install script
  blocked before any script ran; override with --allow-risky

install blocked: 1 package failed the trust check. Override with --allow-risky.
```

`brief`, one line per package, details only for the offender:

```
$ npm install express expres
Warden: vetting 2 packages before install
  ALLOW express@5.1.0  clean
  BLOCK expres@0.0.5   typosquat, install-script
    probable typosquat of express with an install script

install blocked: 1 package failed the trust check. Override with --allow-risky.
```

`block`, silent unless something is wrong, and then only the essentials:

```
$ npm install express expres
warden: blocked expres@0.0.5 (typosquat); npm install aborted, exit 20
```

`log`, never aborts, records everything for later review:

```
$ npm install express expres

added 65 packages in 2.3s

$ warden log --tail 2
2026-07-13T16:41:02Z ALLOW express@5.1.0 risk=4
2026-07-13T16:41:02Z BLOCK expres@0.0.5 risk=92 typosquat,install-script (installed anyway: mode=log)
```

`log` mode is the observability tier: it answers "what would warden have done" during a trial period without changing any behavior. The jsonl file carries full verdict objects; `warden log` renders them.
