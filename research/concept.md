# Better NPM — Concept Report

## Background

Theo (t3.gg), in a widely-viewed video, listed several pieces of developer infrastructure he considers outdated and worth rebuilding now that agentic coding has made rebuilding them cheap. Better NPM and NPX is the first item on that list. His core complaint: npm's install and publish experience gives developers almost no signal about risk, its metadata is thin, and its safeguards haven't kept pace with how packages are attacked today. He credits Socket.dev with already applying AI to catch malicious releases, and argues there is still a lot of room to build something faster, more local, and more agent-aware than what exists.

## The problem landscape

Package publishing carries almost no accountability today. A typo'd version number is permanent once installed anywhere, because unpublish policies (put in place after the 2016 left-pad incident) block takedowns once a release has any dependents. There is no way to flag a brand-new, barely-installed release as reversible. Package pages and install prompts show almost no useful metadata: whether code is obfuscated or readable, whether a package is genuinely open source, who last published a release, or how a name compares to a popular package it might be impersonating. Name-squatting on well-known project names goes largely unpoliced. `npx` in particular asks for a bare yes/no on installing something new with nothing but a version number to go on, which matters more now that coding agents routinely execute `npx` commands from skill files with no human reviewing them first.

Supply-chain attacks have escalated sharply. Sonatype counted over 454,000 new malicious npm packages in 2025 alone, a 75% year-over-year increase, and more than 99% of open-source malware now targets npm specifically. The self-propagating Shai-Hulud worm hit npm in three escalating waves between September 2025 and mid-2026, at one point spreading to PyPI as well; a compromised axios release (100M+ weekly downloads) was attributed to a North Korean state actor; and eighteen widely-used packages including `debug` and `chalk` were hijacked via maintainer phishing. A newer, AI-specific attack, "slopsquatting," exploits the fact that LLMs hallucinate plausible but nonexistent package names in predictable, repeatable ways, and attackers pre-register those exact names. A related documented pattern: 128 unclaimed package names referenced in official docs picked up 121,000 downloads before anyone registered and weaponized them, illustrating exactly the blind-trust problem `npx` has today. npm v12, shipping this month, will disable install scripts by default and restrict git/remote-tarball resolution, matching moves already made or underway in pnpm, Yarn, Bun, and Deno — a sign the whole ecosystem agrees the old defaults are untenable, but it's new, inconsistent, and doesn't help anyone on older versions.

Existing tooling doesn't fully close the gap. `npm audit` scores against theoretical CVSS severity rather than real reachability, and treats dev and build-only dependencies the same as production code, which is a major reason 65% of teams admit to ignoring or delaying its findings. Dependabot is GitHub-only and generates high alert volume at scale; Snyk is strong on compliance but weaker on behavioral analysis; Socket.dev comes closest to real behavioral detection but is a CI/platform product, not something that sits inline in a terminal, and still needs human judgment on its findings.

Structural problems round this out. Phantom dependencies (using a package never declared, only reachable because a sibling hoisted it) persist in npm's and Bun's flat `node_modules` layouts; pnpm avoids this with a symlinked store but breaks some postinstall/native-module packages in the process. npm duplicates dependencies per project, multiplying disk use; Bun's compatibility with Node sits around 95%, and native addons don't work on it at all. Monorepos compound all of this: phantom dependencies that work in a workspace can break on publish, version ranges silently resolve to whatever's on disk, and a naive build command rebuilds everything regardless of what changed. Peer dependency resolution can fail installs outright with no good default fix. The ESM/CommonJS split remains a persistent, unresolved source of confusing errors. The registry itself is a single point of failure serving 20B+ downloads weekly, with real outages on record. License incompatibilities (GPL contamination via transitive dependencies) affect roughly 7% of packages and are hard to track manually.

## Product concept: Better NPM

A drop-in installer and smarter `npx` that never lets a new or changed package run, for a human or an agent, until it has been diffed against the last trusted version and given a plain-English, machine-readable verdict on what changed and why it matters.

The practical build: wrap an existing fast resolver (pnpm or Bun) rather than reinventing dependency resolution, and add a trust layer in front of it. For every new or changed package version, pull both the new and previous tarball from the registry, diff file contents, and combine that with deterministic checks — newly added install scripts, suspicious script content (curl, base64, eval, raw IPs), signs of new obfuscation, recent publish date, changed maintainer, and name-similarity to popular packages. Feed the diff and signals to an LLM for a short risk verdict, show it as a pre-flight report before anything executes, and block high-risk installs by default with an explicit override. For `npx`, replace the bare version-number prompt with package size, last publisher, a risk score, and required permissions — and emit that same verdict as structured output so an agent following a skill file's `npx` instruction can check it before running anything, rather than executing blindly.

Two related asks are effectively platform-level (forcing actual revocation of low-adoption releases, real authority over name-squatting disputes) and out of reach for a third-party tool; a community-reported blocklist and a typosquat-distance heuristic get most of the practical value without needing registry-level control.

## Examples: today vs. with Better NPM

Illustrative only, meant to show the shape of the output, not captured from a real tool.

**Installing a typosquatted package.** Today, a malicious postinstall script runs silently and `npm` even reports zero vulnerabilities, since nothing about this package is a known CVE yet:

```
$ npm install is0dd
> is0dd@1.0.3 postinstall
> node ./setup.js

added 1 package, and audited 2 packages in 0.6s
found 0 vulnerabilities
```

With Better NPM, the install is diffed and scored before anything runs:

```
$ bnpm install is0dd

! trust check: is0dd@1.0.3 (published 6 hours ago, 41 installs)
  - name is 1 character from popular package "is-odd" (2M weekly downloads)
  - postinstall script added (previous versions had none)
  - script makes an outbound network request to an unrecognized host
  - package body is minified/obfuscated, no readable source

  verdict: HIGH RISK - likely typosquat - install blocked
  override with --allow-risky

$
```

**Running an unfamiliar package via `npx`.** Today's prompt gives you a version number and nothing else:

```
$ npx some-cli@latest
Need to install the following packages:
  some-cli@2.1.0
Ok to proceed? (y)
```

With Better NPM, the same prompt carries enough signal for a human, or an agent, to decide:

```
$ bnpx some-cli@latest

some-cli@2.1.0
  size 340KB  -  published 2 days ago  -  1,204 lifetime downloads
  last publish by "new-maintainer" (account created 3 days ago)
  requests: network access, filesystem write
  risk score: 6.5/10 (new maintainer, write access, low install history)

Proceed? (y/N)

--json:
{"package":"some-cli@2.1.0","risk_score":6.5,
 "flags":["new_maintainer","recent_account","fs_write","low_installs"],
 "recommendation":"confirm_with_human"}
```

That last block is what an agent reads before executing an `npx` command from a skill file, instead of running it blindly.

**Auditing a project.** Today's `npm audit` is a flat list with no sense of what's actually reachable:

```
$ npm audit

webpack  4.0.0 - 5.75.0
Severity: high
Prototype Pollution in a transitive loader dependency
fix available via `npm audit fix --force`

postcss  <8.4.31
Severity: moderate
Line-return parsing error

12 vulnerabilities (2 low, 6 moderate, 4 high)
```

With Better NPM, findings are grouped by whether they can actually run in production:

```
$ bnpm audit

Reachable in production (1)
  express-fileupload@1.1.6 - path traversal
  imported in src/upload.ts:14 - fix: bump to 1.5.1

Build-time only, never shipped (8)
  webpack, postcss, eslint-* - present but not in the production bundle

Dev-only, low priority (3)

Summary: 1 issue needs action. 11 filtered as non-reachable or dev-only.
```

## Feature pillars

| Pillar | Core idea |
|---|---|
| Trust & Supply Chain Firewall | Pre-install AI diff plus deterministic heuristics, blocking by default |
| Agent-Safe NPX | Rich pre-run prompt and a machine-readable verdict a coding agent can check before executing |
| Package Transparency | Metadata on obfuscation, open-source status, and maintainer history, shown in the CLI and on the web |
| Performance & Correctness | Content-addressed store, non-flat `node_modules` by default, fast resolver |
| Monorepo & Workspace DX | Pre-publish phantom-dependency and version-mismatch checks, task-graph-aware builds |
| Human-Readable Everything | LLM-explained CLI errors, reachability-aware audit output |
| Private Registry Ergonomics | One-command private registry, easy default-over-public switch |
| License Guardrail | Transitive license scanning with plain-English warnings |

The first two pillars are the core wedge: most novel relative to existing tools, most directly tied to real evidence, and the easiest to demo. The rest are reasonable fast-follows once the core loop works.

## Scope

Core build: the CLI wrapper, tarball diffing, the deterministic heuristic checks, one LLM call per flagged package, a blocking terminal trust report, the richer `npx` prompt, and a machine-readable verdict output. Good additions if time allows: a small dashboard visualizing the dependency tree by trust score, and a basic phantom-dependency check. Lower priority: a custom resolver, real private-registry tooling, and the license guardrail.

## Sources

- [I don't have time to build these things, will you? (YouTube)](https://www.youtube.com/watch?v=wEAb0x3wTRc)
- [npm Supply Chain Attacks: 1.2M Malicious Packages [2026]](https://shattered.io/npm-supply-chain-attacks-2026/)
- ["Shai-Hulud" Worm Compromises npm Ecosystem (Unit 42)](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/)
- [Tradecraft Tuesday Recap: axios npm Supply Chain Compromise (Huntress)](https://www.huntress.com/blog/axios-npm-compromise)
- [Slopsquatting: The AI Package Hallucination Attack Already Happening (Aikido)](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)
- [npx Confusion: Packages That Forgot to Claim Their Own Name (Aikido)](https://www.aikido.dev/blog/npx-confusion-unclaimed-package-names)
- [GitHub to Disable npm Install Scripts by Default (The Hacker News)](https://thehackernews.com/2026/06/github-to-disable-npm-install-scripts.html)
- [npm audit: Broken by Design (overreacted.io)](https://overreacted.io/npm-audit-broken-by-design/)
- [npm left-pad incident (Wikipedia)](https://en.wikipedia.org/wiki/Npm_left-pad_incident)
- [Phantom Dependencies (Socket docs)](https://docs.socket.dev/docs/phantom-dependencies)
- [pnpm vs npm vs Yarn vs Bun: Speed, Disk Usage and Benchmarks (DeployHQ)](https://www.deployhq.com/blog/choosing-the-right-package-manager-npm-vs-yarn-vs-pnpm-vs-bun)
- [Socket.dev vs Traditional SCA Tools](https://vulert.com/blog/socket-dev-vs-traditional-sca/)
- [npm License Compliance and Supply Chain Security (Veln)](https://veln.sh/blog/npm-license-compliance-supply-chain)
