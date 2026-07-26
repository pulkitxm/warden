# Warden speaker script

One block per slide, in order. Terminal slides have a SKIP control that jumps to the final state when time is short.

## 1. Cover

Every dependency change becomes a verified transaction. Warden protects the moment before package code can execute, then proves that the graph installed was the graph reviewed. It plans the complete change, names the exact authority required, suppresses lifecycle scripts, verifies the project, and leaves evidence for CI.

## 2. The dangerous moment

Most dependency tools tell you what they found after a package has been installed. That is too late for a lifecycle script. It already ran with your permissions and could already have reached source, environment variables, registry tokens, or cloud credentials.

Warden moves the decision to the point before download, unpack, or execution. That timing is the product.

## 3. One request becomes a graph

The package name a developer types is not the dependency change. In this example, asking for esbuild changes twenty-seven packages. Twenty-six are transitive.

Checking only esbuild leaves the rest of the prospective graph unexamined. A compromised transitive release is exactly the kind of change a one-package check misses.

## 4. The transaction model

Warden gives the change four stages because each stage closes a different failure mode.

Plan resolves and analyzes the complete prospective graph. Approve replaces a broad bypass with one typed requirement. Apply replays the reviewed request with package scripts suppressed. Verify compares what landed with what was reviewed and runs the project's own checks.

Incomplete coverage cannot become a confident allow.

## 5. Blind graph to reviewable plan

The failure is not that the developer typed the wrong command. The failure is that the request shows one name while hiding the full graph, new scripts, and authority the change will introduce.

`warden plan` closes that visibility gap before installation. The request names one package. Warden resolves twenty-seven changed artifacts, analyzes all twenty-seven, and finds one new install-time execution requirement.

The safe next step is neither a broad allow nor a generic block. It is one approval bound to the package, version, tarball integrity, hook, and script body. Change any field and it no longer matches. Approval authorizes the transaction. The package script still never runs.

## 6. Plan drift to controlled apply

A plan only matters if installation cannot silently resolve a different graph. `warden apply` replays the exact manager command that was planned, suppresses every lifecycle script through the manager's native setting, and runs test, typecheck, and build when the project provides them.

It then digests the graph that actually landed. If that graph differs from the plan, or a verification step fails, Warden restores the manifest and every lockfile.

The receipt records the reviewed graph, observed graph, policy, coverage, approvals, suppressed scripts, verification, and result. The honest boundary is that rollback does not restore node_modules or side effects from project verification.

## 7. Local bypass to receipt-backed CI

Local interception is useful but bypassable. There are three enforcement layers. Guidance teaches the safe loop. Interception mediates normal package-manager commands. Verification makes CI demand a valid transaction receipt.

An absolute path or a container can bypass a PATH shim. Warden does not pretend otherwise. The receipt gate is the control that does not trust the developer machine. If the dependency graph changed without valid evidence, the pull request does not merge.

## 8. Package reputation to release evidence

A familiar package name does not prove that the current release is safe. `warden check` verifies integrity, compares the release with its predecessor, scans JavaScript through an AST walk, checks name attacks and curated intel, and produces a deterministic score.

Warden also audits three repository surfaces. The lockfile answers where bytes will come from. The lifecycle-script audit answers what code would run during installation. The registry-config audit answers where credentials could be sent.

Repeat verdicts are cached by tarball integrity and analyzer version, so analysis stays fast without trusting an older result for different bytes or different rules.

## 9. Manager drift to compiled policy

Package managers already expose valuable controls, but each manager names and types them differently. That creates four chances for the same safety intent to drift. `warden policy` takes one repository intent and compiles it into the strongest native settings available for npm, pnpm, Yarn, or Bun.

It also names gaps instead of hiding them. If a manager cannot express semantic downgrade blocking or lockfile reverification, Warden enforces that intent in the transaction plan and receipt gate.

The project keeps its chosen package manager. Warden detects and preserves it rather than silently changing tools.

## 10. Risky remediation to verified repair

A vulnerability advisory can name a fixed version that is itself a supply-chain risk. Doctor does more than list CVEs.

`warden doctor` reads advisories, builds minimal and latest repair plans, gates every candidate through the same package engine, and verifies surviving plans in an isolated copy of the project before applying one.

In this demonstration, the official fix adds a suspicious install script and loses provenance, so Warden marks it unfixable. A different safe repair installs, passes tests, and is applied.

## 11. Semantic failure to intent evidence

Dependency security is only one failure mode in agent-driven changes. Code can compile while dropping a requirement, changing unrelated scope, or calling an API that never existed.

`warden intent check` decomposes the prompt into claims and compares those claims with the diff. It separates delivered and preserved requirements from dropped work and scope creep. A deterministic symbol scan checks newly added member calls against package exports it can prove.

When the repository carries a prompt file, CI runs the same check automatically for changed JavaScript and TypeScript.

## 12. Terminal prose to automation contract

Automation cannot reliably interpret changing terminal prose. Every Warden surface follows the same exit-code contract and exposes structured JSON, versioned schemas, typed errors, evidence, a suggested fix, and a verification command.

Registry-authored strings are sanitized and kept under an untrusted boundary so a security tool does not become an instruction-injection path.

Adapter setup reports which guidance, interception, post-change, and tool capabilities are actually available. The generated tool surface is read-only. Project-changing commands remain human-controlled.

## 13. Problems choose the command

The audience does not need to memorize a command catalog. Start with the operational failure, then choose the Warden response that produces the required proof.

When a release is risky, check, explain, history, compare, baseline, and scripts produce a verdict, evidence trail, safer candidate ranking, and remediation.

When a guardrail may be broken, coverage, integrations doctor, detect, init, config, and log expose missing layers, repair the setup, and preserve verdict history.

When a team or automated system needs durable proof, install, ci, schema, completions, benchmark, and uninstall provide manager-preserving execution, stable report contracts, reproducible evidence, and lifecycle control.

## 14. Evidence and limits

The benchmark is reproducible from the repository. It runs twenty-one curated dependency-graph shapes through the real resolver and transaction decision. All twelve attack shapes stop. None of the nine benign shapes stop.

These are regression cases, not a claim about field accuracy.

The limits matter too. Local shims are not a sandbox. Scripts remain suppressed even after approval. Rollback covers project manifests and lockfiles, not node_modules. Receipts are unsigned evidence rather than independent attestation.

This is a technical alpha with a working control plane and explicit boundaries.

## 15. Close

Warden does not ask developers to replace their package manager, coding workflow, or CI system. It adds a chain of custody.

A human or automated request becomes a plan, the plan names any required authority, the exact request is applied under suppression and verification, and CI receives a receipt it can enforce.

One decision contract, everywhere: allow, warn, needs approval, or block.

## 16. Sources

The external scale claims come from the Sonatype software supply-chain report and the USENIX Security package hallucination study. Advisory data is represented by OSV. Product and benchmark claims point to the shipped repository documentation, command registry, and published corpus.
