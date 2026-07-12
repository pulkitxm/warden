---
name: warden
description: Use before proposing or running any npm/pnpm/yarn/bun install or npx/bunx command. Vets packages for supply-chain risk (typosquats, malicious install scripts, hijacked releases) and returns a machine-readable verdict. A PreToolUse hook also enforces this automatically, but checking first lets you avoid proposing a risky package at all.
---

# Warden — package trust checks

Warden is a supply-chain trust layer for npm. Before you install or execute a
package, check it and act on the verdict.

## When to use

Before you propose or run any of:
`npm install`, `npm i`, `pnpm add`, `yarn add`, `bun add`, `npx`, `bunx`, `pnpm dlx`.

## How to check

Run the check and read the JSON:

```
warden check <package[@version]> --json
```

The verdict is a JSON object (an array when you pass several packages):

```json
{
  "package": "some-cli@2.1.0",
  "risk_score": 6.5,
  "level": "MEDIUM",
  "flags": ["new_postinstall", "maintainer_changed", "low_install_history"],
  "evidence": ["postinstall script added (previous version had none)"],
  "explanation": "some-cli@2.1.0 warrants a human check: ...",
  "recommendation": "confirm_with_human",
  "cached": false,
  "engine_version": "0.1.0"
}
```

## How to act on `recommendation`

- **`allow`** — proceed with the install/exec.
- **`confirm_with_human`** — do NOT run it silently. Surface the flags and
  evidence to the user and ask them to confirm before proceeding.
- **`block`** — do NOT install or execute. Tell the user why (use the `flags`
  and `evidence`), and if a popular package is being typosquatted, suggest the
  correct name — the `evidence` string names the impersonated package (e.g. for
  `is0dd` the evidence names `is-odd`, so propose `is-odd` instead).

## Note

A PreToolUse hook enforces blocks deterministically even if you forget — a
`deny` decision will come back with a plain-English reason. When that happens,
read the reason, correct the command (fix a typo'd name, drop the bad package,
or pin a known-good version), and try again. Do not attempt to bypass the hook.
