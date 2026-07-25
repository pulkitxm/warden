# Dependency transactions

A package name is not a dependency change. Typing `npm install @fastify/jwt` adds one name to a manifest and, moments later, an entire resolved subgraph to `node_modules`. Checking only the name that was typed leaves every transitive addition unexamined, and a transitive addition is exactly where a compromised release hides.

`warden plan` treats the whole change as one transaction.

## What a plan does

1. Read the requirements: the packages named on the command line, plus everything the manifest already declares.
2. Resolve the complete prospective graph from registry metadata, direct and transitive. Nothing is downloaded, unpacked, or executed to do this.
3. Read the graph that exists today from the lockfile, and the lifecycle hooks of what is actually installed under `node_modules`.
4. Diff the two: additions, version moves, removals, and the packages whose install scripts are new relative to the graph already in place.
5. Vet every added or changed package through the same engine as `warden check`.
6. Return one decision for the transaction, and write the plan to `.warden/plans/<plan-id>.json`.

```bash
warden plan -- npm install @fastify/jwt
warden plan                      # the whole manifest, which is what a bare install really is
warden plan --json -- pnpm add zod
```

## The decision

| Decision | Exit | Meaning |
|---|---|---|
| `ALLOW` | 0 | Every changed package was analyzed and none raised a finding. |
| `WARN` | 10 | Findings worth reading, including deprecated additions, but nothing that stops the change. |
| `NEEDS_APPROVAL` | 10 | The change introduces execution or coverage Warden will not wave through: new install scripts, a truncated graph, or packages left unanalyzed. |
| `BLOCK` | 20 | A changed package is malicious or unanalyzable, or a required dependency did not resolve. |
| error | 30 | The transaction could not be planned at all. |

`NEEDS_APPROVAL` exists so that incomplete coverage is never reported as safety. A plan that analyzed 40 of 60 changed packages says so, in the report and in the JSON, rather than printing a confident allow.

## Coverage is stated, not implied

Every plan carries a `coverage` object: how many changed packages were analyzed, how many changed in total, and the ratio. Two things reduce it:

- **The node budget.** Resolution stops at a bounded number of nodes and sets `truncated`.
- **The analysis budget.** Beyond a fixed number of package checks the remaining artifacts are recorded with the verdict `unchecked` and named individually.

Neither is silent. A truncated or partially analyzed plan cannot reach `ALLOW`.

## What resolution does not cover

Registry ranges resolve. These do not, and each is reported as unresolved rather than trusted:

- `git:` and `github:` sources
- `https:` tarball URLs
- `file:`, `link:`, and `portal:` paths
- `workspace:` protocol ranges

A missing optional dependency does not make a graph incomplete; a missing required one blocks the transaction.

Resolution is flat: one version per package name, which matches how a hoisting installer usually lands. When two dependents require ranges that cannot both be satisfied by the selected version, the conflict is recorded on the plan rather than resolved by guessing.

## Graph digests

Each plan records `graph_before` and `graph_after` as sha256 digests over the sorted `name@version` set. The plan id is derived from the command and the resulting graph, so replanning the same change in the same project yields the same id, and any difference in what would be installed yields a different one.

## Applying

`warden apply <plan-id>` executes a decided plan:

1. Refuse outright if the plan was blocked.
2. Refuse if any new install script has no matching approval, unless `--allow-unapproved` is passed.
3. Install through the project's own package manager with lifecycle scripts suppressed by that manager's native mechanism.
4. Run the project's `test`, `typecheck`, and `build` scripts, in that order, stopping at the first failure.
5. Restore `package.json` if the install or any verification step fails.
6. Write a transaction receipt.

Scripts stay suppressed for the entire install, including for approved packages. An approval governs whether the transaction may proceed at all; it is not a handoff of execution to package code mid-install.

## Narrow approvals

`warden approve-script <pkg@version> --hook <name>` records an approval bound to the package name, the exact version, the tarball integrity, the hook, and a hash of the normalized script body. Change any one of those and the approval no longer applies.

```bash
warden approve-script esbuild@0.25.8 --hook postinstall
warden approve-script sharp@0.33.5 --hook install --scope user
warden approve-script esbuild@0.25.8 --hook postinstall --note "reviewed in PR 412"
```

Repo approvals live in `.warden/approvals.json` and are meant to be committed, so the whole team inherits a reviewed decision rather than each developer waving the same script through. User approvals live under the home directory.

This replaces the pattern of a single broad override. A bypass that is scoped to exactly what was reviewed can be audited later; one that means "allow risk" cannot.

## Receipts

Applying writes a receipt to `.warden/receipts/<transaction-id>.json`, mirrored to `.warden/last-receipt.json`:

```json
{
  "schema_version": 1,
  "transaction_id": "wtxn_...",
  "plan_id": "wtxn_...",
  "command": "npm install @fastify/jwt",
  "manager": { "name": "npm" },
  "graph_before": "sha256:...",
  "graph_after": "sha256:...",
  "policy_digest": "sha256:...",
  "artifacts": [{ "package": "@fastify/jwt", "version": "9.1.0", "verdict": "allow" }],
  "approvals": [],
  "suppressed_scripts": [],
  "verification": { "install": "pass", "test": "pass", "typecheck": "skipped", "build": "skipped" },
  "result": "applied"
}
```

## Verifying in CI

```bash
warden verify
warden ci --require-transaction-receipt
```

`warden verify` compares the graph digest of the lockfile in the repository against the digest the receipt records, compares the policy digest against the plan when one is present, and fails when the transaction was rolled back, a verification step failed, or any artifact was never analyzed.

With `--require-transaction-receipt`, any pull request that changes `package.json` or a lockfile must carry a receipt that verifies. This is the honest answer to the fact that PATH shims can be bypassed: the local shim is convenience, and CI receipt verification is the control. It catches a developer or an agent installing outside Warden without pretending the shim was ever a sandbox.
