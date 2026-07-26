# Intent verification: landscape and defensible position

Companion to [market-gaps.md](./market-gaps.md), which maps the dependency-side threat record to product
decisions. This file does the same job for one feature: `warden intent`, the verb that asks whether a diff
did what the prompt asked. Checked 2026-07-26.

Measurements labelled **measured here** were produced for this note and the command is given so they can be
re-run. Everything else is cited. Claims that could not be corroborated are marked **unverified** rather than
softened.

## 1. Does the category exist?

### The problem has a name, and 2026 gave it one

"Intent drift" is now used as a term of art rather than a description: behaviour diverging from
specification without breaking a test or failing a pipeline. The academic framing is goal drift, and the
ICLR 2026 Lifelong Agents workshop paper *Asymmetric Goal Drift in Coding Agents Under Value Conflict*
(Saebo et al., submitted 2026-03-03, revised 2026-04-24) measures coding agents violating their own system
prompt, finding drift correlates with value alignment, adversarial pressure, and accumulated context, and
that constraints are violated under sustained pressure for some models. The paper reports its findings
qualitatively; it does **not** publish a headline violation rate, so no percentage from it is quotable.

**Warden coverage:** `warden intent check` is the only verb in the product aimed at this failure mode.

**Remaining gap:** Warden has no measurement of its own accuracy on it. See section 4.

### AI code review reads intent but does not adjudicate it

CodeRabbit reads the PR description and commit messages to understand stated intent and evaluate whether the
implementation matches the described goal, and its Pre-Merge Checks gate on description completeness and on a
linked, approved issue. That is the closest commercial behaviour to Warden's framing.

The distinction that survives scrutiny is the **unit of output**. These tools emit review comments on lines.
None of them emits a per-requirement ledger, a stable exit code, or a machine-readable verdict enumerating
which requirements were delivered, dropped, or exceeded. CodeRabbit's pre-merge gate blocks on whether a
description *exists and links an issue*, not on whether each requirement in it was *delivered*.

An independent three-week parallel run (146 merged PRs, 679 findings across 446 review events, published
2026-05-12) reports no assessment at all of whether the four tools evaluate changes against stated PR intent,
which is itself evidence that intent conformance is not what buyers currently compare them on.

**Warden coverage:** per-claim ledger, stable `0`/`10`/`20`/`30` exit codes, published JSON schema.

**Remaining gap:** these tools have vastly more context than Warden (whole-repo indexes, review history) and
they are better at *reviewing a diff*. Warden must not compete there. Section 6 draws the line.

### Spec-driven tooling already verifies, and does it better than Warden

This is the uncomfortable finding. OpenSpec ships `/opsx:verify`, a gate before completion producing a
three-dimension report over completeness (are all tasks done), correctness (does the code match the spec),
and coherence (does it follow the design). GitHub Spec Kit's `/analyze` performs retrospective conformance
analysis on existing code, reporting spec conformance, architectural alignment, and coverage gaps. Tessl's
spec-as-source model deletes the declared target files and rebuilds them from the spec, using divergence as
the drift signal.

All three verify a diff against a *written specification*. Warden verifies against a *prompt*, which it must
first decompose with an LLM because a prompt has no structure. That decomposition step is pure added error
that a spec file does not have.

**Warden coverage:** none of these run as a repo-independent CI gate with an exit code, and all of them
require the team to have adopted a spec workflow first. Warden works on a repo that has nothing but a
one-line prompt.

**Remaining gap:** for a team that already writes specs, `warden intent`'s claim matching is a strictly worse
version of `/opsx:verify`. The docs should say so, and the extraction step should accept a structured spec
instead of insisting on an LLM decomposition. See section 6.

### Guardrails are a placement, not a competing product

Claude Code's Stop hook fires when the agent decides it is finished and can refuse to let the turn end,
feeding a reason back to the model. That is a delivery mechanism, and Warden already uses it
(`demo/claude-code/hooks/verify-intent.ts`). The surrounding ecosystem (promptfoo, Braintrust, LangSmith)
evaluates *prompts and model outputs against datasets*, which is offline evaluation of a model, not diff-time
conformance of a repository change.

**Searched and not found:** an existing primitive, open source or commercial, that takes `(prompt, git diff)`
and returns a per-requirement verdict with an exit code. This is stated as "did not find it", not as "nobody
does this".

## 2. Is the hallucination detector defensible?

### Measured here: what `tsc` and friends already catch

Six hallucination classes, run against `tsc --noEmit`, `eslint-plugin-import`, `knip`, and `depcheck` in
throwaway workspaces. TypeScript 5.9.3, `strict: true`, `allowJs`, `checkJs`.

| Hallucination class | `tsc` (typed pkg) | `tsc` (untyped pkg, `noImplicitAny: false`) | `eslint-plugin-import` | `knip` | `depcheck` | `warden intent` today |
| --- | --- | --- | --- | --- | --- | --- |
| Member a typed package does not export | **TS2339** | silent | no | no | no | yes, if surface provably closed |
| Member an **untyped** package does not export | n/a | **silent** | no | no | no | **yes** |
| Named import the package does not export | **TS2614** | silent | no | no | no | no |
| Package installed but absent from `package.json` | silent | silent | **no-extraneous-dependencies** | **unlisted** | **missing** | no |
| Package that does not resolve at all | TS2307 | TS2307 | **no-unresolved** | **unlisted** | **missing** | no |
| Package name **never published on the registry** | conflated into TS2307 | conflated | conflated | conflated | conflated | no |

The exact outputs, reproducible:

```
$ tsc --noEmit                                    # strict, checkJs, axios installed
bad-named-import.ts(1,10): error TS2614: Module '"axios"' has no exported member 'throttleRequests'.
hallucinated-member.ts(4,10): error TS2339: Property 'throttle' does not exist on type 'AxiosInstance'.
nonexistent-pkg.ts(1,23): error TS2307: Cannot find module 'react-codeshift' or its corresponding type declarations.
plain-js.js(3,8): error TS2339: Property 'throttle' does not exist on type 'AxiosInstance'.
undeclared-import.ts(1,23): error TS2307: Cannot find module 'lodash-es' or its corresponding type declarations.

$ tsc --noEmit                                    # untyped local package, noImplicitAny: false
tsc exit=0                                        # lib.gamma() on a package exporting only alpha, beta

$ eslint src.js
  2:1   error  'sneaky-installed' should be listed in the project's dependencies   import/no-extraneous-dependencies
  3:19  error  Unable to resolve path to module 'react-codeshift'                  import/no-unresolved

$ knip                                            # with entry configured
Unlisted dependencies (2)
sneaky-installed  src.js:2:20
react-codeshift   src.js:3:19

$ depcheck
Missing dependencies
* sneaky-installed: .\src.js
* react-codeshift: .\src.js
```

Three conclusions follow, and two of them are unflattering.

1. **`tsc --noEmit` with `checkJs` catches the member-level hallucination on any package that ships types,
   including in plain `.js` files.** It is faster, more complete, and costs zero tokens. Warden's curated
   six-entry database is not competing with a type checker; it is losing to one.
2. **The undeclared-import class is already covered by three separate tools**, so Warden adding it is not a
   novel capability. What none of them do is scope the finding to the diff or gate on it with a verdict.
3. **Exactly one cell is uncovered by the developer tooling tested:** a package name that has *never been
   published*. `tsc`, eslint, knip, and depcheck all collapse "you forgot to install it", "it has no types",
   and "this name does not exist and never has" into one unresolvable-module message. Distinguishing the
   third requires a registry lookup and hallucinated-name intel, both of which Warden already owns
   (`resolvePackage().existsOnRegistry`, `src/intel/data/hallucinated.json`).

### The dedicated slopsquat scanners, which the table above does not cover

The row above is scoped to *developer tooling a repo already runs*. A second category exists and has to be
named, because "no tool distinguishes a never-published name" is false once you leave that scope. Checked
2026-07-26.

| Tool | What it reads | When it runs | How it decides |
| --- | --- | --- | --- |
| `mattschaller/slopcheck` | `.md`, `.mdc`, `.yml`, `.json`, `.cursorrules` — install commands in prose and config | CI, whole files | live npm registry: nonexistent, unpublished, or security-held (HTTP 451) |
| `0xToxSec/slopcheck` | dependency manifests: `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `composer.json` | pre-install, pre-commit, CI on PRs touching those files | registry existence, plus age, download-count, name-pattern and Levenshtein heuristics |
| Aikido SafeChain, Snyk | manifests and install-time resolution | install / scan | registry existence plus recency and reputation signals |

Both `slopcheck` tools resolve the never-published case correctly and are npm-registry-backed, so the
"nobody does this" framing is wrong. What is still true, and is the narrower claim this note now makes:

- **Neither reads source-code import statements.** One parses install commands out of markdown and config,
  the other parses dependency manifests. An `import x from "fetch-retry-helper-pro"` written into a `.ts`
  file and never added to `package.json` is invisible to both — which is precisely the shape an agent
  produces, because the agent writes the import and forgets the manifest.
- **Neither is diff-scoped.** Warden judges only specifiers on lines the diff *added*, so a pre-existing
  import does not re-flag on every pull request.
- **Existence is the whole rule here, deliberately.** `0xToxSec/slopcheck` also flags packages under seven
  days old, under 100 downloads, or matching `-helper` / `-gpt` / `-ai` / `-utils`. Those are useful
  heuristics and they carry a false-positive rate; Warden's `unpublished_package` rule fires only on "the
  registry says this name does not exist", which is why it can sit at `block` while claim matching cannot.

**Warden coverage:** the same registry answer, applied to added import lines in source, folded into one
verdict with the conformance rules rather than reported as a separate scan.

**Remaining gap:** these tools cover ecosystems Warden does not (PyPI, crates.io, Go, RubyGems, Maven,
Packagist) and catch the manifest-side case Warden's rule ignores by construction. On a repo that runs one of
them against `package.json`, Warden's contribution is the source-import and diff-scoping half, not the
registry lookup itself.

### Measured here: how much untyped surface is actually left

The "untyped repos are the win" argument needs a size. Sample of 300 popular unscoped npm packages drawn from
the registry search API weighted by popularity, classified by whether the latest version declares
`types`/`typings`, ships any `.d.ts` (checked via the jsDelivr file listing), or has a published `@types/`
counterpart. 10.86 billion combined weekly downloads.

| Bucket | Packages | Share of packages | Share of weekly downloads |
| --- | --- | --- | --- |
| Bundled types | 169 | 56.3% | 55.8% |
| `@types/` only | 75 | 25.0% | 38.1% |
| No types at all | 56 | 18.7% | **6.1%** |

The untyped 18.7% is heavily weighted toward transitive plumbing that application code rarely imports
directly: `delayed-stream`, `unpipe`, `extend-shallow`, `duplexer`, `builtin-status-codes`. So the share of
*directly imported* untyped packages is smaller still than 6.1% of download weight.

This kills the "untyped packages" framing of the gap. The real addressable population is different, and it is
**repos with no type check at all**: no `tsconfig.json`, or `checkJs` off, or no `tsc --noEmit` in CI. In
those repos `tsc` reports nothing regardless of how well typed the package is, and Warden's static export
extraction is the only thing that answers.

**Unverified:** what share of JavaScript repositories run a type check in CI. No source found with a
defensible number. This is the load-bearing assumption behind keeping the member-level scan at all, and it is
recorded here as an assumption rather than dressed up as a finding.

### The literature says the deterministic approach is the right one

Rates of API hallucination in generated code are high and measured: 58.1% to 84.1% of recommended APIs do not
exist in the specified package (MagiCoder 84.1%, DeepSeek Coder 82.9%, ChatGPT 58.1%), with non-existent
method names accounting for 77.0% to 81.5% of errors. So the class Warden targets is real and common, not a
demo contrivance.

More directly, *Detecting and Correcting Hallucinations in LLM-Generated Code via Deterministic AST Analysis*
(Khati, Rodriguez-Cardenas, Pantzer, Poshyvanyk, 2026-01-27) does approximately what `src/intent/symbols.ts`
does, on Python: AST parse, validate against a knowledge base built by library introspection, never execute
the code. It reports **100% precision and 87.6% recall (F1 0.934) on 200 manually curated snippets**, and
auto-corrects 77.0% of what it finds. It also states these semantic errors "evade linters".

Two things follow. The architectural choice in Warden is validated by an independent published result. And
100% precision is the bar a deterministic detector is expected to clear, which means a *silent* detector is
the correct failure mode and the existing "only report when the surface is provably closed" rule is right.

**Warden coverage:** AST-based, never executes, silent when unprovable. Architecturally sound.

**Remaining gap:** six curated entries, and a curated database is the wrong shape given the table above. On a
typed repo the type checker already wins; on an untyped repo the curated entries do not help because the long
tail is precisely what is not curated. The database should shrink to what static extraction cannot answer,
not grow toward 200 entries.

## 3. What do the numbers say the false-positive budget should be?

An independent parallel run of four AI reviewers over 146 merged PRs (published 2026-05-12) reports:

| Tool | Findings | False positives | Rate |
| --- | --- | --- | --- |
| Greptile | 120 | 0 | 0% |
| CodeRabbit | 281 | 6 | 2.3% |
| Cursor BugBot | 128 | 6 | 4.8% |
| Sentry Seer | 149 | 6 at high tier | 15% at high tier |

DeepSource publishes a target of "less than 5%" false positives. Against that, the static-analysis
deployment literature is blunt about the consequence of missing it: an excessive number of false positives
"greatly hinders the utilization of static analyzers as developers get frustrated and do not trust the
tools", false positives accumulate because developers fix real defects and leave false positives in place,
and 56% of SAST warnings in one corpus were never addressed at all, with dismissal rates higher for tools
whose findings were less actionable.

Note also that in that four-tool run, **93.4% of findings were caught by exactly one reviewer** and no line
was flagged by all four. Agreement between LLM reviewers on the same diff is low, which is a direct warning
about trusting a single LLM match pass.

**Decision this forces:** the blocking gate gets a stated budget of **at most 5% false positives on benign
cases, targeting 2%**, published next to the measured rate. Any rule that cannot demonstrate it stays inside
that budget must not contribute to a `block`. That is a number the docs can be held to, and it is the
criterion by which the scope-creep rule should live or die.

## 4. The matching ceiling is already known, and it is low

Pass one of `src/intent/match.ts` (tokenize, stem, score keyword overlap against symbols) is a hand-rolled
instance of automated traceability link recovery, a technique with two decades of published evaluation. What
that literature reports:

- Information-retrieval trace-link recommendation across six open-source projects: **average recall 96%,
  average precision 33%.**
- LLM-based trace-link recovery reaches roughly **60-70% recall**, and the authors state plainly that these
  results "remain insufficient to support fully automated traceability without human oversight."
- The field's own convention is that **recall matters more than precision** for traceability, the inverse of
  ordinary information retrieval, because a missed link is a missed requirement.

This is the single most useful research finding for the plan. It says:

1. Keyword-similarity matching has a precision ceiling around a third. Warden's pass one is tuned the
   opposite way, with `score >= 3 && symbolHits >= 1 && coverage >= 0.6` chosen to be conservative, so it
   likely has better precision and far worse recall than the literature's baseline, and its misses fall
   through to an LLM call.
2. Nobody in a field that has studied this for twenty years claims automated matching is good enough to run
   without human oversight. A `block` verdict derived from claim matching is therefore a stronger claim than
   the state of the art supports.
3. Recall-oriented evaluation means a **dropped** claim being missed is the expensive error, and a false
   `allow` is the worst outcome, which is exactly weakness 16 in the brief.

**Warden coverage:** two-pass matching with a deterministic first pass, which is the right architecture.

**Remaining gap:** no measurement, and a verdict severity that the literature does not support. Claim
matching should warn, not block, unless a corpus demonstrates otherwise.

## 5. The trust story

An LLM extracting claims, an LLM matching them, and an LLM having written the diff is three layers of one
failure mode. What the field actually does about that in 2026: offline evaluation, online runtime verifiers,
self-consistency loops, reflection, and inference-time reward models, with the reliability literature warning
that the gap between a naively configured judge and a calibrated one "is wide enough to produce opposite
conclusions", and that test-retest reliability for code judging is not systematically accounted for.

Applied to a per-commit gate, most of those are unaffordable. Self-consistency means N samples per claim,
which multiplies the cost of a check that already runs on every agent turn. What is affordable:

- **A deterministic backstop that survives the LLM being absent.** Costs nothing and is currently missing.
- **Abstention.** A claim returning "cannot verify, and here is why" is cheaper than a second sample and more
  honest than a confident guess. The reliability literature and Warden's own voice both point here.
- **Fixture replay for CI.** Removes test-retest variance from the measurement entirely.

Note the concrete determinism defect: the two flagship zero-key providers shell out to `claude -p` and
`codex exec`, neither of which exposes temperature, so the same inputs can produce different verdicts. The
HTTP providers set `temperature: 0` (`src/intent/llm.ts`). Determinism is currently a property of the
non-flagship path.

## 6. Position: what intent should claim

Reading the sections above together, the defensible position narrows, and narrowing it is the finding rather
than a retreat.

**Warden owns, uniquely and deterministically:**

- A diff-scoped answer to "is this added *import* a package that does not exist". No developer tool a repo
  already runs distinguishes a never-published name from an uninstalled one, and the dedicated scanners that
  do (both `slopcheck` tools, Aikido, Snyk) read manifests, prose, and config rather than source imports. The
  import-line-and-diff scoping is the part Warden owns; the registry lookup is not novel and section 2 says
  so.
- Member-level hallucination detection on surfaces a type checker cannot see, which means untyped packages and
  repos with no type check, reported only when the export surface is provably closed.
- A machine-readable per-requirement ledger with stable exit codes, for a repo that has a prompt and no spec.

**Warden does not own, and should stop implying it does:**

- Member-level hallucination detection on typed packages in a repo that runs `tsc --noEmit`. The type checker
  is better at this. The docs should say so in those words.
- Claim matching as a *blocking* judgment. Twenty years of traceability research declines to claim automated
  matching is good enough to run unsupervised, and low inter-reviewer agreement between LLM reviewers on the
  same diff reinforces it.
- Reviewing a diff on its own merits. That is CodeRabbit's and Greptile's job and they are measurably good at
  it.

**The one-line version:** intent is a dependency-and-conformance gate for repos without a spec, not an AI code
reviewer, and its blocking authority belongs to its deterministic rules rather than to its LLM ones.

## Sources

- [Asymmetric Goal Drift in Coding Agents Under Value Conflict](https://arxiv.org/abs/2603.03456) (ICLR 2026 Lifelong Agents workshop)
- [Intent Drift in AI Code: Fix Regression Blind Spots](https://www.tricentis.com/blog/intent-drift-ai-code-fix-regression-blind-spots)
- [Explainable AI Code Reviews: Inside CodeRabbit's Context Engine](https://www.coderabbit.ai/blog/explainable-reviews-coderabbit-review-context-engine)
- [Pre-Merge Checks: Built-in & custom PR rules enforced](https://www.coderabbit.ai/blog/pre-merge-checks-built-in-and-custom-pr-enforced)
- [Best AI Code Reviewer in 2026? We Ran 4 in Parallel for 3 Weeks (146 PRs, 679 Findings)](https://dev.to/_vjk/best-ai-code-reviewer-in-2026-we-ran-4-in-parallel-for-3-weeks-146-prs-679-findings-1c0f) (2026-05-12)
- [OpenSpec vs GitHub Spec Kit: Same Problem, Different Philosophies](https://www.specnative.dev/blog/openspec-vs-speckit)
- [spec-compare: research comparing 6 spec-driven development tools](https://github.com/cameronsjo/spec-compare)
- [Spec-Driven Development (SDD): The Definitive 2026 Guide](https://thebcms.com/blog/spec-driven-development)
- [Claude Code hooks reference](https://code.claude.com/docs/en/best-practices)
- [Detecting and Correcting Hallucinations in LLM-Generated Code via Deterministic AST Analysis](https://arxiv.org/abs/2601.19106) (2026-01-27)
- [Towards Mitigating API Hallucination in Code Generated by LLMs with Hierarchical Dependency Aware](https://dl.acm.org/doi/abs/10.1145/3696630.3728569) (FSE 2025)
- [Information Retrieval Methods for Automated Traceability Recovery](https://www.researchgate.net/publication/285714412_Information_Retrieval_Methods_for_Automated_Traceability_Recovery)
- [Automated Trace Link Recovery Between Natural Language Requirements and Formal Specifications via LLMs](https://link.springer.com/chapter/10.1007/978-3-032-30693-7_1)
- [Enhancing Requirements Traceability Link Recovery: A Novel Approach with T-SimCSE](https://arxiv.org/html/2603.11800)
- [Static Analysis Deployment Pitfalls](https://arxiv.org/pdf/2202.13026)
- [False Positives Over Time: A Problem in Deploying Static Analysis Tools](https://www.cs.umd.edu/~pugh/BugWorkshop05/papers/34-chou.pdf)
- [How we ensure less than 5% false positive rate (DeepSource)](https://deepsource.com/blog/how-deepsource-ensures-less-false-positives)
- [LLM-as-Judge Patterns for Agent Evaluation: Calibration, Bias, and Trajectory Assessment](https://zylos.ai/research/2026-05-26-llm-as-judge-agent-evaluation-patterns/)
- [Bias in the Loop: Auditing LLM-as-a-Judge for Software Engineering](https://arxiv.org/html/2604.16790v1)
