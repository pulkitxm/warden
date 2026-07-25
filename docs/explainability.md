# Explaining a decision

A verdict that a person cannot act on is a verdict they will eventually route around. Warden's explanation surface exists so that a block leads somewhere.

Every human finding answers four questions:

1. What changed?
2. Why is that dangerous here?
3. What did Warden prevent?
4. What is the safest next action?

```
$ warden explain react-codeshift@0.1.0

BLOCK  react-codeshift@0.1.0
  confidence high · slopsquat

What changed
  react-codeshift@0.1.0 is the first release seen here
  published less than a day ago

Why that matters here
  the name matches a pattern language models are known to invent

Prevented
  the install script did not execute

Safe next action
  warden compare react-codeshift jscodeshift
  warden history react-codeshift

  baseline: none; this is the first release
  heuristic score 62/100, analyzer 0.1.0
```

## Decision, confidence, reason code

The decision leads. Confidence follows, because a block resting on a curated malware match is a different claim from one resting on a single heuristic:

| Situation | Confidence |
| --- | --- |
| Blocklist hit, or a known-malware category | high |
| A fresh clean analysis | high |
| A cached allow | medium |
| A block or warning with more than one piece of evidence | high |
| A warning with a single piece of evidence | medium |
| A block with no evidence attached | low |

Reason codes are the verdict categories, and each is translated into what it means rather than left as a label.

## The score is a heuristic, and labelled as one

Warden still computes a 0 to 100 score from weighted signals, and `warden explain` still reports it, at the bottom, as `heuristic score`. It is not the headline and it is not presented as a probability. A summed score reads as more precise than it is; the decision, the confidence, and the reason code are the parts worth acting on.

## Comparison

```
$ warden compare jscodeshift react-codeshift

Candidate comparison

  ALLOW  jscodeshift@17.0.0
      2,500,000 weekly downloads · 400 days old · provenance attested · no install scripts
      no findings
  BLOCK  react-codeshift@0.1.0
      12 weekly downloads · 0 days old · no provenance · install scripts: postinstall
      name matches a known hallucination pattern

  ordered by evidence, not by preference. warden never installs an alternative for you.
```

Ranking penalises a block, then an unanalyzable candidate, then deprecation, then install scripts, and rewards provenance and real download volume. It is a summary of evidence. Warden does not install an alternative for you, and it does not choose one on the strength of a model's opinion.

## History

```
$ warden history esbuild --tail 4
```

Releases newest first, with the current one annotated: publisher email changed, provenance lost, scripts added, deprecated.

## Standing script surface

`warden plan` shows the scripts a specific change introduces. `warden scripts pending` shows the ones already in your installed graph:

```
$ warden scripts pending

Install scripts in the current graph

  pending   esbuild@0.25.8  postinstall
      warden approve-script esbuild@0.25.8 --hook postinstall
  approved  sharp@0.33.5    install

  read from package-lock.json
```

It exits `10` while anything is pending and `0` once every script carries an approval, which makes it usable as a check.

## Artifact inventory

An AST scan reads JavaScript and TypeScript. An npm tarball can also contain native binaries, WebAssembly, nested archives, and scripts in shell, PowerShell, Python, Ruby, or Perl. Reporting an allow without saying which of those went unread would overstate what happened.

Every verdict built from a fetched tarball now carries an inventory: how many files it held, how many were read as source, and a note for each category that was not. Files are classified by magic bytes first, then by shebang, then by extension, so a Mach-O binary named `index.js` is still reported as a native binary.

```
$ warden explain some-native-package@2.1.0

...

Analysis limits
  41 of 58 files in the tarball were read as source
  6 native binaries are present and were not analyzed; static analysis reads source, not compiled code
  1 nested archives are present; their contents were not unpacked or analyzed
  3 scripts in languages outside the AST analyzer are present in the tarball
```

The inventory is published on the verdict contract as an optional `inventory` object, so an existing consumer keeps parsing unchanged.

## Known limits

- A delta is measured against a trusted baseline: an explicitly recorded version, then one a verified transaction installed, then the version in your lockfile, then, only as a last resort, the previous published release. `warden baseline list` grades what each package currently rests on, and `warden baseline record <pkg@version>` pins a version you have actually audited.
- Static analysis has language and obfuscation limits.
- Warden evaluates risk signals and policy. It cannot prove that code is safe.
