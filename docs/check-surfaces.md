# Check surfaces

`warden check` vets a package spec. It also audits three project surfaces that a package check cannot see, because the risk lives in your repository rather than in a published tarball.

```text
warden check lockfile [--dir <path>] [--json] [--allow-risky]
warden check scripts  [--dir <path>] [--json] [--allow-risky]
warden check config   [--dir <path>] [--json] [--allow-risky]
```

Every surface returns the same exit codes as a package check: `0` clean, `10` warnings only, `20` at least one blocking finding, `30` error. `--allow-risky` downgrades a blocking result to `10`. `--json` writes an `AuditReport`, whose schema is printed by `warden schema audit`.

No surface check contacts the network, and none of them execute project or package code.

## check lockfile

Reads `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, and `yarn.lock` (classic and berry). Bun lockfiles are reported as unsupported in `notes` rather than being silently treated as clean. One rule table covers every format, so a repointed `resolved` URL is caught whichever package manager wrote the file.

| Rule | Level | What it means |
| --- | --- | --- |
| `lockfile_lookalike_registry` | block | An entry resolves from a host impersonating a real registry, the shape of the September 2025 `npmjs.help` phishing campaign. |
| `lockfile_off_registry_host` | block | An entry resolves from a host that is not a known public registry. |
| `lockfile_insecure_transport` | block | An entry resolves over plaintext `http`, so the tarball can be swapped in transit. |
| `lockfile_missing_integrity` | block | A registry tarball was recorded without an integrity hash. |
| `lockfile_weak_integrity` | warn | The integrity hash is `sha1`, which is not collision resistant. |
| `lockfile_git_dependency` | warn | The dependency comes from a git remote, so its contents can change under a tag. |
| `lockfile_file_dependency` | warn | The dependency comes from a local path and is not reproducible elsewhere. |

## check scripts

Reads the root manifest and every `node_modules/*/package.json`, and inspects only the lifecycle hooks npm runs on install: `preinstall`, `install`, `postinstall`, `prepare`, `prepublish`. A `build` or `test` script is not an install hook and is not audited.

| Rule | Level | What it means |
| --- | --- | --- |
| `script_pipes_download_to_shell` | block | A hook downloads a remote payload and pipes it into a shell. |
| `script_raw_ip_endpoint` | block | A hook contacts a bare IP address, bypassing certificate and reputation checks. |
| `script_base64_payload` | block | A hook decodes a base64 blob, hiding its own behaviour. |
| `script_credential_path_access` | block | A hook reads `.ssh`, `.npmrc`, `.aws`, `.env`, or a private key. |
| `script_env_exfiltration` | block | A hook reads the environment and sends it over the network. |
| `script_inline_node_eval` | warn | A hook evaluates inline JavaScript instead of a reviewable file. |
| `script_lifecycle_present` | warn | A hook exists and did not match a dangerous pattern. |

If `node_modules` is absent, only the root manifest is scanned and a note says so, so a clean result is not misread as a clean tree.

## check config

Reads the project `.npmrc` and the one in your home directory. Findings carry the file label and line number. Values are never echoed, so a leaked token is reported without being reprinted.

| Rule | Level | What it means |
| --- | --- | --- |
| `config_lookalike_registry` | block | The registry host impersonates a real one, by brand or by a one to two character typo. |
| `config_insecure_registry` | block | The registry is served over plaintext `http`. |
| `config_plaintext_credential` | block | An `_authToken` or `_password` is written literally rather than read from the environment. |
| `config_tls_verification_disabled` | block | `strict-ssl=false` makes every install interceptable. |
| `config_custom_registry` | warn | Packages resolve from an unfamiliar host. |
| `config_scripts_forced_on` | warn | `ignore-scripts=false` re-enables install hooks. |

## Why these three

A package check reads a published tarball. These three surfaces are where trust is lost without any package changing:

- The lockfile decides **where** a tarball is fetched from, so a rewritten `resolved` URL redirects an otherwise clean dependency.
- Lifecycle scripts decide **what runs** at install time, which is how Shai-Hulud 2.0 propagated through `preinstall`.
- `.npmrc` decides **which registry is trusted** and **which token is sent to it**, which is what a lookalike host is trying to collect.

## In CI

`warden ci` runs a surface audit when that surface changed in the diff: a `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock` change triggers the lockfile audit, a `package.json` change triggers the scripts audit, and an `.npmrc` change triggers the config audit. Untouched surfaces are not scanned, so the gate stays scoped to the pull request.

This closes the gap where a pull request changes no dependency version, and so passes a version-diff check, while rewriting where those dependencies resolve from or what runs at install time. Surface findings merge into the same finding list, honour `ci.failOn`, appear in `--reporter github` annotations, and are written to `.warden/last-run.json` for `warden handoff`.

See [the threat research](../research/citations.md) for the incidents behind each rule.
