# Warden presentation context

Speaker notes for the deck. Read the four numbered sections before presenting; the rest is reference.

## 1. The one-sentence story

Warden turns every dependency change, whether a human or a coding agent makes it, into a planned, policy-checked, narrowly approved, verified transaction.

## 2. The problem in one minute

Installing a package executes code with your permissions, and that code can reach your environment variables, source, cloud credentials, SSH keys, and registry tokens. The dangerous moment is not when a scanner reports a vulnerability later. It is the instant between requesting a package and letting it run.

Three things made that moment worse. Popular packages are takeover targets, so one phished maintainer reaches millions of machines. Malicious releases live for hours, which is faster than human review but not faster than an automated pipeline. And coding agents now install packages autonomously, repeating names from instructions and prior output without ever proving the package is real.

The scale is already large. Sonatype counted 454,648 new malicious open-source packages in 2025. A USENIX Security 2025 study found 19.7 percent of 576,000 model package recommendations were hallucinated, producing 205,474 unique names, and 43 percent of those names recurred across runs, which makes them predictable enough to register in advance.

## 3. Why a package check is not enough

This is the part worth landing, because it is what separates Warden from a scanner.

Checking the package name you typed misses the change you actually made. `npm install @fastify/jwt` adds one name to a manifest and twenty-three packages to `node_modules`. Vetting the one name leaves the other twenty-two unexamined, and a transitive addition is exactly where a compromised release hides.

So Warden treats the change as a transaction:

1. **Plan.** Resolve the complete prospective graph from registry metadata, without running a line of package code. Diff it against the lockfile. Vet every added or changed package.
2. **Approve.** If the change introduces an install script, approve that one script, bound to its exact version, tarball digest, hook, and script body. Change any of those and the approval is void.
3. **Apply.** Install through the project's own package manager with lifecycle scripts suppressed by that manager's native setting. Run the project's tests.
4. **Verify.** Emit a receipt. In CI, `warden ci --require-transaction-receipt` fails a pull request whose graph changed without one.

That last step is the honest part of the pitch. PATH shims are convenience, not a sandbox, and an absolute path or a container bypasses them. The CI receipt gate is the control that does not depend on anything having worked on the developer's machine.

## 4. The live demo, with real numbers

`warden plan -- npm install esbuild` on a cold cache:

- 27 packages resolved and 27 analyzed, complete coverage, in about 26 seconds
- one package, `esbuild` itself, carries a `postinstall`
- decision `NEEDS_APPROVAL`, with the exact approval command printed
- scripts stay suppressed until the approval exists

One thing to rehearse rather than discover on stage. A plan has two resolvers, and it names the one it used in its `resolver` field. When npm or pnpm is on `PATH`, Warden lets that manager resolve in a throwaway directory, which is the most faithful answer to "what would this manager select" but carries no lifecycle-hook or platform detail, so the execution surface reads as zero and the decision comes back `ALLOW`. The numbers above come from the metadata walk, which is the fallback and what the interception shim always uses. Run the demo the way the shim runs it, or in a project whose manager cannot do a lockfile-only resolve, and check the output before the room does.

Contrast with what a scanner would say: "esbuild is fine." Warden's answer is "esbuild is fine, and here is the one piece of code in this change that wants to execute."

Measured detection, reproducible with `warden benchmark`: 12 of 12 curated attack shapes stopped, 0 of 9 benign shapes stopped. Those are curated regression shapes, not field accuracy, and the deck should say so.

## What to say about maturity

Say it is a technical alpha with a working core, not a production security boundary. Specifically:

- Graph resolution is flat, one version per package name, so duplicate versions and peer variants are not yet modelled the way a real manager resolves them.
- Failure restores the root manifest, not the lockfile or `node_modules`. That is a manifest rollback, not a transaction rollback.
- Receipts are unsigned local JSON. They are reproducible evidence, not yet an independent attestation.

Saying this out loud is a strength in a security pitch. The website has a Limitations page for the same reason.

## Recent attacks and what they teach us

These incidents are useful because they represent four different failure modes. Together they show why a known-vulnerability database alone is not enough.

### 1. chalk and debug account takeover, September 2025

An attacker phished a trusted maintainer through the lookalike domain `npmjs.help`. The compromised account published malicious versions across 18 packages, including `chalk`, `debug`, and `ansi-styles`. Those packages represented more than two billion weekly downloads combined.

The malicious releases were available for roughly two hours. Their payload targeted browser cryptocurrency activity by intercepting wallet and network operations, then redirecting transactions.

Why this matters:

- The package names were legitimate.
- The maintainer account had a long history and strong reputation.
- Download counts and popularity could not distinguish the poisoned release from a safe one.
- Defenders needed to notice that a specific release changed behavior, not merely recognize the package name.

The Warden response is release-level trust. It checks known-malicious versions, diffs the new release against the previous one, scans package capabilities, and blocks the exact compromised versions before installation.

### 2. Shai-Hulud 2.0, November 2025

Shai-Hulud 2.0 was a self-replicating npm worm. Settled reporting identified 796 packages and 1,092 affected versions with about 20 million weekly downloads. The campaign added a `preinstall` script, stole credentials, exposed GitHub users and organizations, and used compromised publishing access to spread into more packages.

Unlike a conventional campaign that depends on a command-and-control server, this worm could read and reproduce its own content. That made the package ecosystem itself part of the propagation mechanism.

Why this matters:

- Install scripts are an execution boundary, not harmless package metadata.
- One compromised package can become a path into many more packages.
- A malicious release can spread through trusted dependency relationships faster than a central blocklist is updated.
- The package manager normally reaches the dangerous script before a human reviews it.

The Warden response is pre-execution interception. It detects newly added or changed lifecycle scripts, checks the code they invoke, identifies credential access and exfiltration capabilities, and stops the package manager before any script runs.

### 3. react-codeshift agent slopsquat, January 2026

`react-codeshift` looked plausible because it blended the names of real tools such as `jscodeshift` and `react-codemod`, but the package did not exist. The command was traced to a commit containing 47 generated agent skill files. Those instructions propagated to 237 repositories through forks, were translated, and continued to cause daily execution attempts from autonomous coding agents.

A defender eventually registered the package name to prevent an attacker from claiming it. The important security fact is that the name was both invented and repeatedly reused.

Why this matters:

- Traditional typosquat detection looks for misspellings of an existing package. A hallucinated name may be a completely new but convincing string.
- Repository instructions can become a software distribution channel for commands.
- One bad instruction can be copied into hundreds of projects.
- An agent may execute `npx` directly, giving the named package a path to immediate code execution.

The Warden response is an agent-aware slopsquat guard. It vets `npx`, `bunx`, and package install requests, checks curated hallucinated names and name-risk signals, returns a machine-readable verdict, and gives the agent an explicit stop condition.

### 4. axios maintainer compromise, March 2026

A compromised maintainer account published malicious `axios@1.14.1` and `axios@0.30.4`. The two releases appeared within a 39-minute window and remained available for about three hours. They introduced `plain-crypto-js@4.2.1`, which delivered a cross-platform remote access payload.

The attacker had published an apparently clean version of the added dependency earlier to establish history. The strongest signals were the dependency change and a provenance downgrade from the project's established publishing process to a bare command-line publish with changed publisher details.

Why this matters:

- A package can retain its trusted name while its publishing identity changes.
- Package age alone is weak when an attacker prepares infrastructure in advance.
- The malicious code may arrive through a newly added dependency rather than an obvious install script.
- A short release cooldown helps, but it does not explain or evaluate what changed.

The Warden response is release comparison. It verifies tarball integrity, detects maintainer and publisher changes, flags provenance downgrades, examines new dependencies and capabilities, and combines those signals into a deterministic verdict.

## Claims to avoid

Avoid claims that are broader than the evidence:

- Do not say that no free or open-source supply-chain security tools exist.
- Do not say package managers have no security controls.
- Do not say Warden prevents every supply-chain attack.
- Do not describe roadmap checks as already shipped.
- Do not claim that a generated explanation makes the security decision.

Use these precise alternatives:

- "Existing tools solve fragments of the problem. Warden unifies the pre-execution decision across package managers, CI, and coding agents."
- "Native controls reduce exposure. Warden adds cross-manager analysis and one portable verdict."
- "Warden blocks the attack patterns it detects before package code runs."
- "Deterministic rules decide the verdict."

## Sources

- [CVE Program metrics](https://www.cve.org/About/Metrics)
- [Verizon 2026 Data Breach Investigations Report summary](https://www.verizon.com/about/news/breach-industry-wide-dbir-finds)
- [Sonatype 2026 software supply-chain report](https://www.sonatype.com/state-of-the-software-supply-chain/2026/open-source-malware)
- [USENIX Security 2025 package hallucination study](https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen)
- [Datadog analysis of Shai-Hulud 2.0](https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/)
- [Aikido analysis of the chalk and debug compromise](https://www.aikido.dev/blog/npm-debug-and-chalk-packages-compromised)
- [Vercel response to the September 2025 npm attack](https://vercel.com/blog/critical-npm-supply-chain-attack-response-september-8-2025)
- [axios maintainer incident report](https://github.com/axios/axios/issues/10636)
- [Microsoft analysis of the axios compromise](https://www.microsoft.com/en-us/security/blog/2026/04/01/mitigating-the-axios-npm-supply-chain-compromise/)
- [Aikido analysis of react-codeshift propagation](https://www.aikido.dev/blog/agent-skills-spreading-hallucinated-npx-commands)
- [GuardDog project documentation](https://github.com/DataDog/guarddog)
- [OSV-Scanner documentation](https://google.github.io/osv-scanner/)
- [Socket CLI documentation](https://docs.socket.dev/docs/socket-cli)
- [npm install security settings](https://docs.npmjs.com/cli/install/)
- [Yarn security features](https://yarnpkg.com/features/security)
- [Bun trusted dependency documentation](https://bun.com/docs/guides/install/trusted)

All incident figures in this document use the repository's verified research notes and later settled counts where available.
