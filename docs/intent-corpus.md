# Intent corpus

[docs/benchmark.md](./benchmark.md) exists because a detection rate published without its corpus is a number
you are asked to take on faith. `warden intent` shipped without one for a year. This is that corpus, and the
first numbers it produced are bad. They are published anyway, because the alternative is a gate whose accuracy
nobody has measured.

```
$ warden intent bench

Warden intent corpus  analyzer 0.1.0

  verdicts        84.2%  16/19 cases match the expected verdict and per-claim outcomes
  false positives 20.0%  2/10 conforming shapes not allowed  over budget 5.0%

  Per rule
    claim_matching   precision  60.0%  recall 100.0%  3/3 found, 2 false
    scope_creep      precision 100.0%  recall 100.0%  1/1 found, 0 false
    hallucination    precision 100.0%  recall 100.0%  3/3 found, 0 false
```

The first run of this corpus, before anything was fixed, measured **verdicts 72.2%, false positives
40.0%, claim_matching precision 28.6%**. The change between those numbers and the ones above is one
rule: preservation. See "Where the false positives come from" below.

Run it with `warden intent bench`. It needs no network, no API key, and no provider: every LLM response in the
corpus is a recorded fixture. `warden intent bench --json` writes the full report, and
`web/src/lib/intent-corpus.json` is generated from the same run by `bun scripts/export-intent-corpus.ts`. A
test asserts the published figures match what the binary produces today, so these numbers cannot drift from
the code.

## The false-positive budget

**At most 5%, targeting 2%.** That is a commitment, stated here so it can be held against the measured rate
directly above it, which is currently **20%**, four times the budget.

The number comes from what comparable tools measurably achieve. An independent three-week parallel run of four
AI reviewers over 146 merged pull requests (May 2026) measured CodeRabbit at 2.3%, Cursor BugBot at 4.8%,
Greptile at 0%, and Sentry Seer at 15% on its high tier. DeepSource publishes a target of under 5%. The
static-analysis deployment literature is consistent about what happens above that line: developers stop
trusting the tool and leave its findings in place. Sources are in
[research/intent-landscape.md](../research/intent-landscape.md).

Until the measured rate is inside the budget, **claim matching should not be the reason a pull request is
blocked**. The rule that is inside budget is hallucination detection, at 100% precision.

## What counts as a false positive

A **conforming** case is a diff a careful reviewer would pass: it delivers what the prompt asked and nothing
else. It counts as a false positive when the verdict is anything other than `allow`. A warning counts, because
a warning on a clean diff is the thing that trains people to ignore the tool.

A **violating** case is a diff that drops a requirement, adds unrequested work, or calls an API that does not
exist. A **degraded** case exercises what happens when a provider is unavailable; it is scored for correctness
but kept out of the false-positive denominator, because it is not a statement about a diff.

Cases listed as known gaps are counted as failures in these figures. They are not excluded from the rates,
only from the exit code, so `warden intent bench` fails on a new regression rather than on a recorded one.

## Per rule, because they fail differently

| Rule | Precision | Recall | Reading |
| --- | --- | --- | --- |
| `claim_matching` | 60.0% | 100.0% | Finds every dropped requirement, and is wrong two times in five when it says one was dropped. |
| `scope_creep` | 100.0% | 100.0% | Correct on this corpus, on a single positive case. Do not read a rate off one case. |
| `hallucination` | 100.0% | 100.0% | The only rule currently earning the authority to block. |

Claim matching's precision being the weak number is not a surprise. Automated requirement-to-code trace-link
recovery has been studied for two decades, and information-retrieval methods on six open-source projects
measure 96% recall at **33% precision**. The first measured figure here, 28.6%, landed almost exactly on that
published ceiling. It is now 60%, and the remaining errors are no longer in a Warden rule.

**Where the false positives came from, and where they are now.** The first run's four false positives were
three-quarters one rule: a preservation claim used to be resolved by checking that *no hunk touches a symbol
whose tokens the claim names*, a negative proxy with no positive evidence behind it. It failed a diff that
renamed the function the claim named, a reformat whose keywords happened to name the reformatted functions, and
an extract-module refactor requested in so many words.

That rule now looks for positive evidence instead, and a claim is `dropped` only when what it names is deleted
and does not appear in the file afterwards:

| Situation | Outcome | Evidence |
| --- | --- | --- |
| What the claim names was deleted and is absent afterwards | `dropped` | the hunk that removed it |
| What it names changed, and only by hunks a matched claim cited | `delivered` | the requested hunk |
| What it names changed, by a hunk no claim asked for | `partial` | the uncited hunk |
| What it names is still declared and unchanged | `delivered` | where it still lives |
| Nothing in the diff names it | `delivered` | stated as exactly that, and nothing more |

A `formatting_only` hunk can never fail a preservation claim, because the classifier proved its added and
removed lines are identical apart from whitespace.

The two remaining false positives are both the match LLM contradicting a diff a reviewer would pass: it called
a fully delivered module extraction `partial`, and a delivered simplification `dropped`. Those are not fixable
by tuning a threshold. They are the case for a deterministic backstop and for abstention, and they are why
claim matching should not be blocking a pull request at this measured precision.

## What the corpus does not measure

- **It is 18 curated shapes, not a sample of real pull requests.** Read the rates as regression signals, the
  same caveat `docs/benchmark.md` carries.
- **A 10-case conforming population cannot resolve a 5% budget.** The measurement floor is one case, 10
  percentage points. The corpus can tell you 40% is far outside budget; it cannot tell you 4% from 6%. Growing
  the conforming population is the honest way to fix that and it has not been done.
- **Claim statuses are not pinned on every case.** Where a diff attempts a requirement through an API that
  does not exist, whether that requirement counts as delivered is genuinely ambiguous, so those cases pin the
  verdict and the hallucination count and declare claim truth `unpinned` rather than invent a per-claim answer.
- **One recorded sample per case.** The fixtures are real responses from one provider (`claude` CLI, haiku) at
  one point in time. They do not measure how much a verdict moves between providers or between runs, which
  matters because the zero-key CLI providers cannot set temperature.
- **Scope creep has one positive case.** Its 100% is arithmetic, not evidence.

## Drift, on purpose

`WARDEN_INTENT_CORPUS_LIVE=1 warden intent bench` runs the same cases against the configured live provider
instead of the fixtures. It is off by default so the corpus stays free and deterministic, and it exists so
provider drift is something you go looking for rather than something that surprises a release.

## How a case is built

A case is a prompt, a set of before-and-after file images, a recorded claim extraction, a recorded match
response, and the outcome a careful reviewer would expect. Diffs are not stored as patches and not taken from
live git state: they are synthesized from the file images by an LCS differ whose hunk boundaries were checked
byte-for-byte against `git diff` on both the merge and the split case. That keeps a case readable as
before-and-after code while still driving the real unified-diff parser.

Every case then runs through the same `runIntentPipeline` the CLI calls, with only the LLM swapped for the
recording. Nothing about the classifier, the keyword pass, the preservation rule, the scope-creep rule, or the
hallucination scan is stubbed.

## A finding the corpus produced immediately

The deterministic keyword pass matched **zero claims across all 18 cases**. "Deterministic first, LLM second"
is the architecture, but in practice every claim reaches the LLM. Two causes, both measured rather than
guessed: real extracted claims are long sentences, so the `coverage >= 0.6` requirement is almost unreachable;
and claim keywords are lowercased on the way in, which destroys the camelCase boundary the tokenizer splits
on, so a keyword of `retryrequest` can never match a symbol tokenized as `retry` + `request`.
