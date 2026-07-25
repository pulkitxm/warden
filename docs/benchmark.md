# Benchmark

A detection rate published without the corpus behind it is a number you are asked to take on faith. Warden's is reproducible: `warden benchmark` runs a curated corpus through the same resolver and the same decision logic the CLI uses, and the published figures at [warden.pulkit.page/benchmark](https://warden.pulkit.page/benchmark) are generated from that run.

```
$ warden benchmark

Warden benchmark  analyzer 0.1.0

  detection       100.0%  12/12 malicious shapes stopped
  false positives 0.0%  0/8 benign shapes stopped
  mean coverage   100.0%  of changed packages analyzed

  every case matched its expected decision
```

## What counts as caught

A malicious shape counts as caught only when the decision **stops the install**, which means `BLOCK` or `NEEDS_APPROVAL`. A warning does not count: a warning that a developer scrolls past has not prevented anything.

A benign shape counts as a false positive when the decision stops it. False positives are the failure mode that gets a security tool uninstalled, so they are reported next to detection rather than in a footnote.

## The corpus

Twelve attack shapes, each exercising a path that per-package checking misses:

| Case | Shape |
| --- | --- |
| `mal-grandchild` | a malicious package three levels below the one typed |
| `mal-transitive-postinstall` | a clean direct dependency whose child runs at install time |
| `mal-preinstall` | a preinstall script, which runs before anything is unpacked |
| `mal-compromised-patch` | a patch release adding a script the trusted version lacked |
| `mal-vanished-dep` | a dependency that no longer resolves |
| `mal-transitive-git` | a child pulled straight from a git repository |
| `mal-transitive-url` | a child resolving to an arbitrary https tarball |
| `mal-needle-in-haystack` | one malicious leaf among twelve clean siblings |
| `mal-optional-dep` | a malicious optional dependency |
| `mal-diamond` | a diamond whose shared package is compromised |
| `mal-cycle` | a dependency cycle containing a malicious node |
| `mal-prepare-hook` | a prepare script, which npm also runs at install time |

Eight benign shapes that must not be stopped: a lone dependency, a ten-level chain, a thirty-wide fan-out, a diamond, scoped packages, caret and tilde ranges, an unchanged project, and an upgrade of a package whose install script was already trusted.

## Regression, not marketing

`warden benchmark` exits `20` if any case no longer matches its recorded decision. A rule that quietly weakens fails the build instead of moving an average, and a test asserts the figures published on the website match what the binary produces today.

## What these numbers are not

These are curated shapes, not a sample of the registry. They measure whether the decision logic still behaves as designed on the paths it was built for. They do not measure field accuracy against real-world malware, and they should not be read as a claim about it. Read the limitations page on the website alongside them.

The heuristic score is deliberately absent from this benchmark. It has not been calibrated against a labelled corpus, which is why it is labelled a heuristic everywhere it appears and is never the headline.
