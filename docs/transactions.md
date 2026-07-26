# Dependency transactions

A package name is not a dependency change. Typing `npm install @fastify/jwt` adds one name to a manifest and, moments later, an entire resolved subgraph to `node_modules`. Checking only the name that was typed leaves every transitive addition unexamined, and a transitive addition is exactly where a compromised release hides.

`warden plan` treats the whole change as one transaction.

## What a plan does

1. Read the requirements: the packages named on the command line, plus everything the manifest already declares.
2. Resolve the complete prospective graph, direct and transitive. Nothing is downloaded, unpacked, or executed to do this.
3. Read the graph that exists today from the lockfile, and the lifecycle hooks of what is actually installed under `node_modules`.
4. Diff the two: additions, version moves, removals, and the packages whose install scripts are new relative to the graph already in place.
5. Vet every added or changed package through the same engine as `warden check`.
6. Return one decision for the transaction, and write the plan to `.warden/plans/<plan-id>.json`.

Every plan also records the `request` it was built from: the manager, the operation, the exact argv, the working directory, the specs, and the dependency class. `warden apply` replays that request rather than reconstructing an install command, so what is applied is the command that was planned.

## Two resolvers

Step 2 has two implementations, and the plan says which one produced it in its `resolver` field. They differ in who picks the versions, not in what gets reported about them.

- `resolver: "manager"`. Warden copies the manifest, lockfile, and registry config into a temporary directory and asks the project's own package manager to resolve there with no scripts and no downloads: `npm install --package-lock-only`, `pnpm --lockfile-only`, `yarn install --mode=update-lockfile`. The manager's own solver picks the versions, so the answer is the one that manager would actually install, peer resolution and all. Used whenever the manager is on PATH and can do it.
- `resolver: "metadata"`. Warden walks the registry metadata itself, breadth-first, taking one version per package name. This is the fallback, and it is what `bun`, `yarn add`, and the interception shim use.

Either way, every changed package is then described from its registry manifest, so install scripts, deprecations, and platform constraints are reported the same on both paths. What a manager-resolved graph does not carry is the dependency structure: `requiredBy` is empty and every node sits at depth 1, because a lockfile records what was selected rather than who asked for it.

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

Each plan records `graph_before` and `graph_after` as sha256 digests over the sorted `name@version|integrity|source` lines of the graph, so a republished tarball at the same version changes the digest. The plan id is derived from the command and the resulting graph, so replanning the same change in the same project yields the same id, and any difference in what would be installed yields a different one.

## Applying

`warden apply <plan-id>` executes a decided plan:

1. Refuse outright if the plan was blocked.
2. Refuse if any new install script has no matching approval, unless `--skip-script-approval` is passed.
3. Refuse if the graph was truncated or any changed package went unanalyzed, unless `--allow-incomplete-analysis` is passed.
4. Refuse if the project's graph has moved since the plan was made, unless `--allow-stale-plan` is passed.
5. Replay the planned request through the project's own package manager with lifecycle scripts suppressed by that manager's native mechanism.
6. Run the project's `test`, `typecheck`, and `build` scripts, in that order, stopping at the first failure.
7. Digest the graph that actually landed and record it as `observed_graph`. If it is not the graph the plan reviewed, roll back.
8. Restore the manifest and every lockfile if the install fails, a verification step fails, or the observed graph does not match. `node_modules` and anything verification touched are left as the failure left them, so this is not a full transaction rollback.
9. Write a transaction receipt.

## What an approval authorizes

Warden implements one model, and it is worth stating plainly, because the word "approve" invites the other reading.

Package install scripts never run. Not before an approval, not after one, not for the package you approved. Every install warden performs suppresses lifecycle scripts through the manager's own mechanism, and the plan and receipt both record `script_policy: "suppressed"` so this is not left to interpretation.

An approval is authority over the transaction, not a handoff of execution to package code. Approving `esbuild`'s `postinstall` says: I have read that script, I accept this graph, proceed with the install. It does not say: run it.

The consequence is real and worth knowing before you rely on it. A package whose install step exists to fetch or compile a native binary may not work afterwards. That is what verification is for: your tests, typecheck, and build run against the installed graph, and if the package is unusable without its install step, they are what tells you. If they fail, the manifest and lockfiles are restored.

The alternative model, executing a reviewed script in a constrained phase with restricted environment, network, and filesystem, and recording its outputs and filesystem delta in the receipt, is a stronger product. It is not built, and warden does not claim it.

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
  "transaction_id": "wtxn_acb0875bfa27e1ebfa8caeaf",
  "plan_id": "wtxn_8f2eb19ab77eb529",
  "command": "npm install @fastify/jwt",
  "manager": { "name": "npm" },
  "graph_before": "sha256:3bc2b0696976ac757083c3619fc897fcd717ac39d5785209bcc9639785c06fdb",
  "graph_after": "sha256:a127760fecb753989d333faeadc1cc2d2fd46d384fea3649fd8431414af3d9f5",
  "observed_graph": "sha256:a127760fecb753989d333faeadc1cc2d2fd46d384fea3649fd8431414af3d9f5",
  "request_digest": "sha256:851a2325b0d111e16d289f244a18ffb39ff1d06485c9167feabe397f203e914d",
  "policy_digest": "sha256:835c4b54e47b8c9348b7a79a86bb8bd55a0d25e95d8cd4608e383744667794d7",
  "artifacts": [{ "package": "@fastify/jwt", "version": "10.2.0", "verdict": "allow" }],
  "approvals": [],
  "suppressed_scripts": [],
  "verification": {
    "install": "pass",
    "test": "skipped",
    "typecheck": "skipped",
    "build": "skipped"
  },
  "result": "applied",
  "analyzer_version": "0.1.0"
}
```

`graph_after` is what the plan predicted. `observed_graph` is what the lockfile said once the install finished, and `request_digest` covers the manager, operation, argv, working directory, workspace, dependency class, and the exact and global flags, so a receipt cannot be reused for a different command that happened to produce the same graph.

## Verifying in CI

```bash
warden verify
warden ci --require-transaction-receipt
```

`warden verify` compares the graph digest of the lockfile in the repository against the digest the receipt records, compares the policy digest against the plan when one is present, and fails when the transaction was rolled back, a verification step failed, or any artifact was never analyzed.

With `--require-transaction-receipt`, any pull request that changes `package.json` or a lockfile must carry a receipt that verifies. This is the honest answer to the fact that PATH shims can be bypassed: the local shim is convenience, and CI receipt verification is the control. It catches a developer or an agent installing outside Warden without pretending the shim was ever a sandbox.
