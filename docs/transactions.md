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
