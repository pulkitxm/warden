# Intent verification

## Should you turn this on?

Read this section, not the pipeline, to decide.

**Turn it on if** your repo has no type check in CI, or you want a diff-time gate on added imports of
packages that are undeclared or do not exist. Those are the parts of this feature that are deterministic,
measured at 100% precision, and not done by anything else you already run.

**Do not turn its claim matching on as a blocking gate.** Measured precision is 60% against a 5%
false-positive budget it does not meet. See [intent-corpus.md](./intent-corpus.md) for the numbers and
[research/intent-landscape.md](../research/intent-landscape.md) for why the ceiling is where it is.

**If you already run `tsc --noEmit` with `checkJs`,** the member-level hallucination scan adds almost
nothing: the type checker catches the same thing faster, more completely, and for zero tokens. The honest
comparison is in the research note, with the commands and outputs.

**Cost per run:** two LLM calls at most, on summaries and excerpts rather than the raw diff, plus one
registry lookup per added import that is neither declared nor installed. `warden intent diff`,
`warden intent symbols`, and the dependency scan cost nothing. `--offline` removes the network entirely.

## What it does

`warden intent check` reads the diff against the merge base, decomposes a prompt you supply into atomic claims, and checks whether the diff delivers each claim, drops it, or goes beyond it. It also runs two deterministic scans that need no LLM: one for calls to APIs a package does not export, and one for added imports of packages that are undeclared or unpublished.

## Usage

```text
warden intent [check|extract|diff|symbols|bench|schema] [--prompt <text>] [--base <ref>] [--json] [--offline] [--help]
```

- `check` runs the full pipeline and prints a verdict. This is the default subcommand.
- `extract` prints just the claims decomposed from the prompt.
- `diff` prints the classified hunks.
- `symbols` prints just the hallucination scan.
- `bench` runs the evaluation corpus offline and prints per-rule precision and recall.
- `--prompt <text>` is the instruction the agent was given. Falls back to `.warden/prompt.txt` when used from `warden ci`.
- `--base <ref>` compares against a git ref instead of the auto-detected merge base.
- `--json` writes the report JSON to stdout.
- `--offline` skips the registry lookup, and the report says the check was skipped rather than reporting clean.

## Verdict to action

| Verdict | Exit | What it means | What a human does | What an agent does |
| --- | --- | --- | --- | --- |
| `allow` | `0` | Every claim delivered, no unrequested scope, no deterministic finding | nothing | proceed |
| `warn` | `10` | A claim is partial, scope creep was flagged, an import is undeclared, or claims could not be verified at all | read `notes` and the claim rows; this is advisory | report the warning back and proceed |
| `block` | `20` | A claim was dropped, an API that does not exist was called, or an import names a package that does not exist | fix or override deliberately | fix the finding before handing back |
| error | `30` | The run could not read the diff: not a git repo, or the base ref does not exist | fix the invocation | fix the invocation |

A missing or failing LLM is **not** an error. The run publishes the deterministic report with
`claims_status: "unverifiable"`, exits `20` if a deterministic rule found something and `10` otherwise, and
records why in `notes`. Scope creep is not assessed in that state, because it needs a claim set, and the
report says so rather than reporting zero.

There is currently **no waiver mechanism**. A verdict you disagree with can only be dropped by removing the
prompt, which disables the whole check. This is a real gap and it is listed as one.

## Pipeline

1. **Diff**: `git diff <mergeBase>`, plus untracked files synthesized as a diff, parsed into hunks.
2. **Classify**: each hunk is parsed with an AST walk (acorn) and bucketed into a category: new function, signature change, import added/removed, conditional changed, assignment changed, formatting only, deletion, test or doc, other. Deterministic, no LLM.
3. **Scan hallucinations**: see below. Deterministic, no LLM.
4. **Extract claims**: one LLM call decomposes the prompt into atomic claims (behavior, preservation, constraint, structural). This step has no non-LLM fallback: if it fails, the whole check errors out with exit `30`.
5. **Match, pass one**: deterministic keyword and stem overlap between each claim and each hunk's symbols and summary.
6. **Match, pass two**: a second LLM call resolves whatever claims pass one left unmatched. If this call fails, those claims degrade to partial rather than failing the run.
7. **Decide**: merges both passes, resolves preservation claims separately, flags scope creep, and produces the verdict.

Matching is heuristic-first: the cheap keyword pass runs before the LLM is asked to look at anything.

## Hallucination detection

Purely static. It never runs code. For each package a diff's added lines call a member on, it looks up that package's export surface: first in a small curated database (`src/intent/api-db.ts`, currently `axios`, `express`, `zod`, `lodash`, `node:fs`, `node:path`), and if the package isn't there, by statically extracting exports from `node_modules/<package>` with an AST walk.

A finding requires the surface to be fully resolvable statically (no `export *`, no dynamic `Object.assign` on exports) and only checks member accesses on lines the diff added. This means it will not catch a hallucinated call to a package outside the curated six whose exports can't be proven closed, and it will not catch a pre-existing hallucination that isn't on an added line.

The curated database is deliberately **not** growing. On a repo that runs `tsc`, curation adds nothing the type checker already does better; on a repo that does not, the long tail is exactly what curation cannot reach and static extraction is the mechanism that scales. It is a zero-IO fast path for six popular packages, not a coverage claim.

## Undeclared and unpublished imports

Deterministic, no LLM. For every bare import specifier on an **added** line:

| Rule | Level | Fires when |
| --- | --- | --- |
| `known_hallucinated_name` | `block` | the name is on Warden's curated slopsquat intel list |
| `unpublished_package` | `block` | the name is not declared, not installed, and the registry says it does not exist |
| `undeclared_import` | `warn` | the name is not in any dependency group of `package.json` |

The registry lookup runs only for names that are neither declared nor present in `node_modules`, so a normal
run makes no network calls at all. When no lookup is available, or it does not answer, the report records
that the existence check was skipped rather than reporting clean.

`knip` and `depcheck` already report undeclared imports repo-wide, and `eslint-plugin-import` reports
unresolvable ones. What none of them distinguish is a name that has **never been published**, which they
collapse into the same unresolvable-module message. That distinction is the one this rule adds.

Not covered: workspace protocol imports beyond name matching, imports added on lines the diff did not touch,
and dynamic `import(expr)` with a computed specifier.

## Preservation claims

A preservation claim ("keep the retry logic") is resolved from positive evidence:

| Situation | Outcome |
| --- | --- |
| what the claim names was deleted and is absent from the file afterwards | `dropped` |
| what it names changed, and only by hunks a matched claim cited | `delivered` |
| what it names changed, by a hunk no claim asked for | `partial` |
| what it names is still declared and unchanged | `delivered` |
| nothing in the diff names it | `delivered`, and the evidence says exactly that |

A `formatting_only` hunk can never fail a preservation claim. This replaced a negative proxy that failed a
rename of the function a claim named; the corpus numbers before and after are in
[intent-corpus.md](./intent-corpus.md).

## Scope creep

Any hunk not cited by a matched claim, not `formatting_only` or `test_or_doc`, with 5 or more added lines. This is a fixed line-count threshold, not a semantic judgment about whether the change was actually out of scope. The corpus has one positive case for this rule, so its reported 100% precision is arithmetic rather than evidence, and the threshold remains an uncalibrated heuristic.

Non-JavaScript files are **excluded** from scope creep, and the report's `notes` names them and says they were excluded from claim matching too. The classifier extracts no symbols from them, so the keyword pass can never match one to a claim, and flagging them on line count alone was a false positive with no evidence behind it. The consequence is stated rather than hidden: a Python or Go file added without being asked for will not be reported as unrequested. If you need that judged, it needs a classifier for that language, which is out of scope here.

## Providers

Claim extraction and the second match pass call an LLM. Provider is chosen by `WNPM_LLM_PROVIDER`, or by the first available credential in the order `openai`, `groq`, `ollama`. `claude` and `codex` are also supported, shelling out to the local CLI instead of an HTTP API.

## JSON report

`IntentReport` contains the following fields.

| Field | Meaning |
| --- | --- |
| `schema_version` | Report schema version. Currently `2`. |
| `prompt` | The prompt that was checked against. |
| `base` | The merge base commit the diff was taken against. |
| `claims` | Each claim with its status (delivered, partial, dropped), matched hunks, and evidence. |
| `scope_creep` | Hunks that were changed but never cited by a claim. |
| `hallucinations` | API calls that don't exist on the package they were called on. |
| `dependencies` | Added imports that are undeclared, on the slopsquat list, or unpublished. |
| `claims_status` | `verified`, or `unverifiable` when the prompt could not be decomposed. |
| `verdict` | `allow`, `warn`, or `block`. |
| `exit` | The process exit code for that verdict. |
| `llm` | Count of extract and match calls actually made, read from the provider counter. |
| `notes` | What was not checked and why. Never empty when a check was skipped. |

### Migrating from schema_version 1

`schema_version` went from `1` to `2`. Two required fields were added, `claims_status` and `notes`, plus
`dependencies`. Nothing was removed or renamed, so a reader that ignores unknown fields keeps working; a
reader that validates against the version-1 schema needs updating. The behaviour change that goes with it:
a failed claim extraction used to exit `30` with no report, and now publishes a report with
`claims_status: "unverifiable"` and exits `20` or `10`.

## Trying it

Run `sh demo/intent/setup.sh` to build a seeded demo repo with one dropped requirement, one scope-creep rewrite, and one hallucinated `axios` call, then `warden intent check` inside it. Run `make test-intent` for the focused intent test suite.
