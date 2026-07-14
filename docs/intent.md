# Intent verification

## What it does

`warden intent check` reads the diff against the merge base, decomposes a prompt you supply into atomic claims, and checks whether the diff delivers each claim, drops it, or goes beyond it. It also runs a deterministic scan for calls to APIs that a package does not export.

## Usage

```text
warden intent [check|extract|diff|symbols|schema] [--prompt <text>] [--base <ref>] [--json] [--help]
```

- `check` runs the full pipeline and prints a verdict. This is the default subcommand.
- `extract` prints just the claims decomposed from the prompt.
- `diff` prints the classified hunks.
- `symbols` prints just the hallucination scan.
- `--prompt <text>` is the instruction the agent was given. Falls back to `.warden/prompt.txt` when used from `warden ci`.
- `--base <ref>` compares against a git ref instead of the auto-detected merge base.
- `--json` writes the report JSON to stdout.

Exit code `0` means every claim was delivered. Exit code `10` means a claim was partially matched or the diff has unrequested scope creep. Exit code `20` means a claim was dropped or a hallucinated API call was found. Exit code `30` means an error, most often a failed LLM call during claim extraction.

## Pipeline

1. **Diff** — `git diff <mergeBase>`, plus untracked files synthesized as a diff, parsed into hunks.
2. **Classify** — each hunk is parsed with an AST walk (acorn) and bucketed into a category: new function, signature change, import added/removed, conditional changed, assignment changed, formatting only, deletion, test or doc, other. Deterministic, no LLM.
3. **Scan hallucinations** — see below. Deterministic, no LLM.
4. **Extract claims** — one LLM call decomposes the prompt into atomic claims (behavior, preservation, constraint, structural). This step has no non-LLM fallback: if it fails, the whole check errors out with exit `30`.
5. **Match, pass one** — deterministic keyword and stem overlap between each claim and each hunk's symbols and summary.
6. **Match, pass two** — a second LLM call resolves whatever claims pass one left unmatched. If this call fails, those claims degrade to partial rather than failing the run.
7. **Decide** — merges both passes, resolves preservation claims separately, flags scope creep, and produces the verdict.

Matching is heuristic-first: the cheap keyword pass runs before the LLM is asked to look at anything.

## Hallucination detection

Purely static. It never runs code. For each package a diff's added lines call a member on, it looks up that package's export surface: first in a small curated database (`src/intent/api-db.ts`, currently `axios`, `express`, `zod`, `lodash`, `node:fs`, `node:path`), and if the package isn't there, by statically extracting exports from `node_modules/<package>` with an AST walk.

A finding requires the surface to be fully resolvable statically (no `export *`, no dynamic `Object.assign` on exports) and only checks member accesses on lines the diff added. This means it will not catch a hallucinated call to a package outside the curated six whose exports can't be proven closed, and it will not catch a pre-existing hallucination that isn't on an added line.

## Scope creep

Any hunk not cited by a matched claim, not `formatting_only` or `test_or_doc`, with 5 or more added lines. This is a fixed line-count threshold, not a semantic judgment about whether the change was actually out of scope.

## Providers

Claim extraction and the second match pass call an LLM. Provider is chosen by `WNPM_LLM_PROVIDER`, or by the first available credential in the order `openai`, `groq`, `ollama`. `claude` and `codex` are also supported, shelling out to the local CLI instead of an HTTP API.

## JSON report

`IntentReport` contains the following fields.

| Field | Meaning |
| --- | --- |
| `schema_version` | Report schema version. |
| `prompt` | The prompt that was checked against. |
| `base` | The merge base commit the diff was taken against. |
| `claims` | Each claim with its status (delivered, partial, dropped), matched hunks, and evidence. |
| `scope_creep` | Hunks that were changed but never cited by a claim. |
| `hallucinations` | API calls that don't exist on the package they were called on. |
| `verdict` | `allow`, `warn`, or `block`. |
| `exit` | The process exit code for that verdict. |
| `llm` | Count of extract and match calls made, for cost visibility. |

## Trying it

Run `sh demo/intent/setup.sh` to build a seeded demo repo with one dropped requirement, one scope-creep rewrite, and one hallucinated `axios` call, then `warden intent check` inside it. Run `make test-intent` for the focused intent test suite.
