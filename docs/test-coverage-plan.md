# Test coverage plan

Written after the structure and feature work landed, and kept as the record of what the suite is actually for. It lives in `docs/` rather than `extras/`, because `extras/` is listed in `.gitignore` and nothing written there would be committed.

## Where the bar is

`bunfig.toml` enforces `coverageThreshold = 1.0`. Every file under `src/` and `fixtures/` is at 100% line and function coverage, and CI fails on a drop. That makes the interesting question not "what is uncovered" but "what is covered badly": code a test executes without ever asserting the behaviour that matters.

The suite is offline. `fixtures/registry` serves packuments, tarballs, download counts, and OSV responses, so no test reaches the network and no live malware is ever downloaded.

## Risk map

| Module | If it is wrong | Coverage shape |
| --- | --- | --- |
| `engine.ts` | A malicious package is allowed, or a clean one is blocked | Integration against the fixture registry, plus a false-positive suite over popular packages |
| `heuristics/` | Capability detection misses an exfiltration path | Attack-shaped fixtures per signal; AST scan tested on real tarball layouts |
| `distance/` | Typosquats slip past, or common names are flagged | Table-driven distance cases including homoglyphs and transpositions |
| `intel/` | A known-compromised release installs | Blocklist and hallucinated-name fixtures drawn from real incidents |
| `diff.ts` | A provenance downgrade goes unnoticed | Version-pair fixtures covering scripts, maintainers, and attestations |
| `doctor/` | A compromised version is applied as a "fix" | Gate-blocked fix, verify failure, apply rollback, installed-version gating, 51-project matrix |
| `audit/` | A repointed lockfile or hostile install hook passes CI | One case per rule, per lockfile format, plus degradation paths |
| `intent/` | A dropped requirement or invented API is reported as fine | Claim, hunk, and symbol fixtures, plus LLM-failure degradation |
| `shared/untrusted.ts` | Warden becomes a prompt-injection vector | ANSI, zero-width, bidi, control characters, truncation, and an injection-shaped string |
| `cli/` | Exit codes or JSON shapes break silently | Contract tests over help, schemas, exit codes, and reporters |
| `shell/` | Interception breaks a developer's package manager | Installer and shim tests covering intercept on, off, and passthrough |

## What each layer must prove

**Unit.** Pure logic edges: semver comparison and range satisfaction, score thresholds, distance including transposition, schema key agreement, error envelope shape, sanitisation of hostile strings.

**Integration.** The one-go paths, end to end against the fixture registry: a blocklist hit, a typosquat, a doctor plan whose official fix is gated away, a CI run in agent reporter form, an intent run with a dropped claim.

**Contract.** These are the tests that protect users of the tool rather than the code:

- Help text contains the documented usage line, and `make ci` greps the built binaries for it.
- Every published schema is printed by `warden schema`, and `schema list` names them all.
- A real verdict's keys stay inside the published schema properties, with required keys present. This is what caught the additive `untrusted` field.
- Exit codes: `0`, `10`, `20`, `30`, asserted per verb rather than assumed.
- `warden doctor` and `wnpm doctor` produce byte-identical JSON for the same project.
- Layering: no domain module imports the CLI layer, and no `cli/` module exceeds 300 lines.

**Incident-oriented.** Fixtures shaped after documented attacks, never live samples: the chalk blocklist class, a `preinstall` that pipes a download into a shell, a raw-IP beacon, a registry host impersonating `npmjs.org`, a hallucinated package name, a provenance downgrade between two versions.

## Deliberate gaps

- **No live OSV in CI.** Advisory responses come from the fixture registry. A live-network test would be flaky and would make the suite depend on someone else's uptime.
- **No real malware.** Every hostile fixture is synthesised to have the shape of an attack, not its payload.
- **No runtime behaviour.** Warden never executes package code, so no test asserts on runtime behaviour. That is a product boundary, not a coverage gap.
- **Bun lockfiles are unparsed**, so there is nothing to test yet. The audit reports them in `notes` rather than reporting clean, and that reporting is tested.

## Keeping it honest

A test that cannot fail is worse than no test. When adding one, break the behaviour on purpose first and confirm the test goes red. Coverage at 100% is a floor that catches deletions, not evidence that the assertions are meaningful.
