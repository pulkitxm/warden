# Command coverage

A security tool earns trust through verifiable coverage, not through a claim. `warden coverage` prints exactly which package-manager commands the shims mediate, generated from the same grammar the shim executes at runtime, so the matrix cannot drift from behaviour.

```sh
warden coverage
warden coverage --json
```

## What is mediated

| Kind | Behaviour |
| --- | --- |
| `install` | Registry specs are vetted before delegation, and the manager's native script suppression is applied |
| `frozen-install` | Treated as a graph transaction: the lockfile is audited before delegation. This covers `npm ci` |
| `exec` | The package about to execute is vetted first. Scripts are not suppressed, because running the tool is the point |
| `rebuild` | Mediated, because rebuild re-runs install scripts |
| `global-install` | Mediated like an install |
| `passthrough` | Anything outside the grammar, such as `npm run` or `npm publish`, is executed untouched |

## Script suppression

Warden uses each manager's native control rather than inventing its own:

| Manager | Control |
| --- | --- |
| npm | `--ignore-scripts` appended to the delegated command |
| pnpm | `--ignore-scripts` appended to the delegated command |
| yarn | `YARN_ENABLE_SCRIPTS=0` in the delegated environment |
| bun | none needed; Bun does not run arbitrary dependency lifecycle scripts by default |

## Non-registry sources

Git, remote-tarball, and local-path specifications carry no registry provenance or integrity guarantee, so they are **blocked by default** rather than silently skipped. `--allow-risky` permits one after review.

## What the shim does not mediate

These are documented rather than quietly claimed:

- absolute executable paths, for example `/usr/local/bin/npm install`
- Corepack-managed shims, which resolve their own binaries
- package managers invoked inside a container or devcontainer
- arbitrary shell downloads piped to an interpreter
- Windows and PowerShell

PATH shims are not an operating-system sandbox. Where interception can be bypassed, CI is the backstop: `warden ci` audits the lockfile, install scripts, and registry config on the merge-base diff regardless of how the change was produced.
