# Warden presentation context

Everything needed to present the hackathon deck and answer product questions.

## The one sentence

Warden turns every dependency change into a planned, policy-checked, narrowly authorized, verified transaction that CI can require evidence for.

## The communication job

By the end, judges should understand that Warden protects the dependency-change moment scanners miss because it plans the whole graph before package code executes and proves that the reviewed result is the result that landed.

## The problem

Installing a package can execute code with the developer's permissions. That code can reach environment variables, source, cloud credentials, SSH keys, and registry tokens.

The dangerous moment is not when a scanner reports a vulnerability later. It is the instant between requesting a dependency and allowing package code to run.

Three forces increase the risk:

- Popular packages are takeover targets, so a compromised maintainer account can affect a large graph quickly.
- Malicious releases may remain live for only hours, which is faster than manual review but not faster than an automated pre-execution gate.
- Automated coding workflows can repeat plausible package names without proving that the package is real or intended.

Sonatype reported 454,648 new malicious open-source packages in 2025. The USENIX Security 2025 package hallucination study produced 205,474 unique package names from model recommendations.

## Why one-package checking is insufficient

`npm install esbuild` names one direct dependency but resolves a much larger graph. The captured demonstration changes twenty-seven packages. Twenty-six are transitive.

Vetting only the name typed by the developer leaves the transitive changes unexamined. A compromised leaf, optional dependency, shared node, or newly introduced lifecycle script can hide there.

Warden treats the graph delta as the security decision.

## The transaction

### Plan

`warden plan` asks the project's own package manager for a lockfile-only resolution in a throwaway directory when the manager supports it. Otherwise, Warden resolves through registry metadata.

It reads the existing lockfile, resolves the prospective direct and transitive graph, computes additions, version moves, removals, and new lifecycle hooks, then vets every added or changed package.

The plan records:

- the manager, operation, exact arguments, working directory, specs, and dependency class
- the graph before and graph after as integrity-aware digests
- every graph change and artifact verdict
- analysis coverage
- typed requirements for scripts, truncated resolution, or unanalyzed packages
- one decision: `ALLOW`, `WARN`, `NEEDS_APPROVAL`, or `BLOCK`

A truncated graph or partial analysis cannot become `ALLOW`.

### Approve

`warden approve-script` records one approval bound to:

- package name
- exact version
- tarball integrity
- lifecycle hook
- normalized script-body hash

The approval authorizes the transaction. It never authorizes the package script to execute. Every Warden-managed install suppresses lifecycle scripts.

Repository approvals can be committed for team review. A repository can require repository-scoped approvals so a personal local approval does not authorize the project.

### Apply

`warden apply` refuses blocked, stale, incomplete, or unapproved plans unless the caller uses the corresponding explicit exception.

It replays the exact request that was planned through the project's manager, with lifecycle scripts suppressed by the manager's native mechanism. It then runs project scripts in this order when present:

1. test
2. typecheck
3. build

The observed graph digest must match the reviewed graph digest.

When installation, verification, or graph comparison fails, Warden restores the root manifest and every lockfile. It does not restore node_modules or side effects created by project verification.

### Verify

Apply writes a receipt containing the request digest, policy digest, graph digests, artifact verdicts, approvals, suppressed scripts, verification results, and final transaction result.

`warden verify` checks the installed graph against that receipt.

`warden ci --require-transaction-receipt` fails a pull request when a dependency manifest or lockfile changed without a valid receipt.

This is the answer to local bypass. PATH shims are convenience, not a sandbox. CI verification does not assume that local interception succeeded.

## Shipped functionality by problem

### What will this dependency introduce?

- `warden check`: vet packages before installation or execution
- `warden plan`: resolve and decide the full prospective graph
- `warden explain`: show what changed, why it matters, and what to do
- `warden history`: trace publisher, provenance, and lifecycle-script changes
- `warden compare`: compare candidate packages on evidence
- `warden baseline`: record a trusted release for later comparison
- `warden scripts`: inventory current lifecycle hooks and pending approvals

The deterministic vetting pipeline covers integrity, release deltas, lifecycle-script changes, maintainer and publisher changes, provenance downgrades, name attacks, known malicious versions, known hallucinated names, and static code capabilities.

### Can the repository itself redirect or execute unsafe code?

- `warden check lockfile`: off-registry and impersonating hosts, plaintext transport, weak integrity, git and file sources
- `warden check scripts`: risky lifecycle hooks across the installed tree
- `warden check config`: lookalike registries, plaintext tokens, and disabled TLS

Secret values are not echoed into reports.

### Can we state policy once across package managers?

`warden policy` compiles repository intent into native npm, pnpm, Yarn, and Bun settings.

The policy covers approved scripts, minimum release age, exotic sources, lockfile reverification, and semantic downgrades. Warden reports which controls each manager can express natively and which remain enforced by the transaction and CI layers.

Manager detection preserves the project's selected tool. Precedence is the invoked binary, the `packageManager` field, the lockfile, project config, tools on PATH, then a documented npm default.

### How are ordinary commands intercepted?

The installer places shims for npm, pnpm, Yarn, Bun, npx, and bunx on PATH.

The command grammar mediates install, add, ci, exec, dlx, rebuild, global-install, and related execution paths. Unsupported or non-registry sources are named rather than silently skipped.

`warden coverage` prints the interception matrix from the same grammar the shims execute.

Protect mode blocks. Observe mode records verdicts without blocking. `warden log` renders that history.

### How do we repair an existing vulnerable project safely?

`warden doctor` and `wnpm doctor`:

1. audit direct dependencies through OSV
2. build minimal and latest repair plans
3. gate every candidate fix through the package engine
4. verify surviving plans in an isolated project copy with scripts disabled
5. apply the recommended verified version by default

An advisory's official fix can be marked unfixable when the candidate release fails the supply-chain gate.

### How do we verify that a change matches the request?

`warden intent check` decomposes a prompt into atomic claims and compares them with the merge-base diff.

It reports delivered requirements, preserved requirements, dropped requirements, scope creep, and calls to package members that the static export surface proves do not exist.

Claim extraction and unmatched semantic comparison use the configured provider. The hallucinated-API check is deterministic static analysis and never executes project code.

`warden ci` runs intent verification automatically when `.warden/prompt.txt` exists and JavaScript or TypeScript changed.

### How do automated systems consume the result safely?

Every reporting surface follows stable exit codes:

- `0`: allow or success
- `10`: warn, partial, or needs approval
- `20`: block
- `30`: analysis or operational error

Structured output includes versioned schemas and typed error envelopes. Registry-authored strings are stripped of ANSI escapes, zero-width characters, bidirectional overrides, and control characters, then quarantined as untrusted data.

The generated tool manifest exposes read-only decision commands and excludes mutating commands. The handoff bundle includes the finding, evidence, concrete fix, and verification command.

CI supports summary, JSON, workflow annotation, agent, and SARIF reporters.

### Are the guardrails actually wired correctly?

- `warden detect`: classify topology, package manager, framework, role, and tooling with evidence
- `warden init`: add repository config, workflow, hooks, and context files
- `warden integrations doctor`: inspect PATH order, shim presence, interception settings, adapter selection, project manager, and CI workflow
- `warden agent doctor`: report adapter capability and fallback layers
- `warden schema`: publish report contracts
- `warden completions`: generate bash, zsh, and fish completion scripts from the command registry
- `warden uninstall`: remove binaries, shims, config, cache, and shell setup

## Demonstration beats

### Plan

`warden plan -- npm install esbuild`

- twenty-seven changed packages resolved
- twenty-seven artifacts analyzed
- one postinstall requirement
- decision `NEEDS_APPROVAL`
- lifecycle scripts remain suppressed

The point is not the command output. The point is that the transaction reveals the complete change and names the one authority requirement.

### Doctor

`warden doctor`

- one advisory fix is rejected because the candidate release adds an install script, exposes exfiltration capability, and loses provenance
- a separate safe candidate installs and passes the project's test in isolation

The point is that a version fixing a CVE can still be an unsafe release.

### Intent

`warden intent check`

- rate limiting delivered
- retry behavior preserved
- logging requirement dropped
- unrelated pagination file changed
- added call references an export that does not exist

The point is that compilation success does not prove instruction fidelity.

## Benchmark

`warden benchmark` runs twenty-one published regression cases through the real graph resolver and plan decision:

- twelve of twelve curated attack shapes stop
- zero of nine benign shapes stop
- mean changed-artifact coverage is complete

These are curated regression shapes, not a registry sample and not field accuracy.

## Maturity and limits

Describe Warden as a technical alpha with a working transaction core.

- PATH shims are convenience, not a sandbox.
- Approvals authorize a transaction, not package code execution.
- A package that requires an install hook may fail verification because scripts remain suppressed.
- Rollback restores the root manifest and lockfiles, not node_modules or verification side effects.
- Receipts are unsigned local JSON, so they are evidence rather than independent attestation.
- Registry-metadata fallback resolution uses one version per package name and is not identical to every manager's solver.
- Intent verification only reports hallucinated members when the export surface can be proven closed and the call appears on an added line.

Stating these limits is part of the security case.

## Claims to avoid

- Do not say that package scanners are useless. Say that Warden adds a pre-execution whole-graph decision and transaction evidence.
- Do not say package managers lack security controls. Say that Warden compiles intent into their native controls and fills explicitly named gaps.
- Do not say Warden prevents every supply-chain attack. Say that it stops the attack shapes its deterministic rules detect before package code runs.
- Do not present benchmark regression rates as field accuracy.
- Do not claim local shims cannot be bypassed.
- Do not claim rollback restores the full working directory.
- Do not claim receipts are signed attestations.

## Sources

- [Sonatype software supply-chain report](https://www.sonatype.com/state-of-the-software-supply-chain/2026/open-source-malware)
- [USENIX Security 2025 package hallucination study](https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen)
- [OSV-Scanner documentation](https://google.github.io/osv-scanner/)
- [Warden benchmark](https://warden.pulkit.page/benchmark)
- [Transactions](https://warden.pulkit.page/docs/transactions)
- [Command coverage](https://warden.pulkit.page/docs/coverage)
