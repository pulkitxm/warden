# Warden presentation context

Everything you need to present. Sections 1 to 5 are the pitch; the rest is reference for questions.

## 1. The one sentence

Warden turns every dependency change, whether a human or a coding agent makes it, into a planned, policy-checked, narrowly approved, verified transaction.

## 2. The problem, in one minute

Installing a package executes code with your permissions, and that code can reach your environment variables, source, cloud credentials, SSH keys, and registry tokens. The dangerous moment is not when a scanner reports a vulnerability later. It is the instant between requesting a package and letting it run.

Three things made that moment worse. Popular packages are takeover targets, so one phished maintainer reaches millions of machines. Malicious releases live for hours, faster than human review but not faster than a pipeline. And coding agents now install packages autonomously, repeating names from instructions and prior output without proving the package is real.

Sonatype counted 454,648 new malicious open-source packages in 2025. A USENIX Security 2025 study found 19.7 percent of 576,000 model package recommendations were hallucinated, producing 205,474 unique names, and 43 percent recurred across runs, which makes them predictable enough to register in advance.

## 3. Why checking the package is not enough

This is the part that separates Warden from a scanner, so land it.

`npm install esbuild` adds one name to your manifest and 27 packages to your graph. Vetting the one name you typed leaves 26 unexamined, and a transitive addition is exactly where a compromised release hides.

So Warden treats the change as a transaction:

1. **Plan.** Ask your own package manager to resolve the complete prospective graph, without running a line of package code, then diff it against your lockfile and vet every added or changed package.
2. **Approve.** Anything that needs authority is named as a typed requirement: an install script, packages left unanalyzed, a truncated graph. A script approval is bound to the exact version, tarball digest, hook, and script body, and it authorizes nothing else.
3. **Apply.** Install through your own manager with lifecycle scripts suppressed by that manager's native setting, run your tests, and restore the manifest and every lockfile if anything fails or the installed graph is not the one that was reviewed.
4. **Verify.** Emit a receipt. In CI, `warden ci --require-transaction-receipt` fails a pull request whose graph changed without one.

The honest part of the pitch: PATH shims are convenience, not a sandbox, and an absolute path or a container bypasses them. The CI receipt gate is the control that does not depend on anything having worked on a developer's machine.

## 4. The demo, with real numbers

`warden plan -- npm install esbuild`:

- 27 packages resolved, 27 analyzed, complete coverage
- one package, `esbuild` itself, carries a `postinstall`, and 26 platform-specific binaries would be added
- decision `NEEDS_APPROVAL`, with the exact approval command printed
- about ten seconds cold, about one second warm, though this is machine and network dependent, so measure it on the machine you present from

Then `warden apply <id>` refuses, naming the unapproved script. Approve it, apply again, and the receipt records `result: applied`, `script_policy: suppressed`, the approval, and an observed graph digest equal to the planned one.

A scanner says "esbuild is fine." Warden says "esbuild is fine, and here is the one piece of code in this change that wants to execute, and here is proof of what was installed."

Measured detection, reproducible with `warden benchmark`: 12 of 12 curated attack shapes stopped, 0 of 9 benign shapes stopped. Say "curated regression shapes," not "field accuracy."

## 5. What to say about maturity

Say it is a technical alpha with a working core, not a production security boundary. Specifically:

- An approval authorizes the transaction, not the code. Install scripts never run, even approved ones, so a package that needs its install step to fetch or compile a binary may not work. Verification is what surfaces that.
- Rollback restores the manifest and every lockfile. It does not restore `node_modules` or anything verification touched, so it is not a full transaction rollback.
- Receipts are unsigned local JSON. Reproducible evidence, not an independent attestation.
- When your manager cannot do a lockfile-only resolve, Warden falls back to walking registry metadata, one version per package name, which is close to what a manager picks but not identical.

Saying this out loud is a strength in a security pitch. The site has a Limitations page for the same reason.

## Recent attacks and what they teach

Four incidents, four different failure modes. Together they show why a known-vulnerability database is not enough.

**chalk and debug takeover, September 2025.** A maintainer was phished through the lookalike domain `npmjs.help`. The compromised account published malicious versions across 18 packages including `chalk`, `debug`, and `ansi-styles`, more than two billion weekly downloads combined, available for roughly two hours, targeting browser cryptocurrency activity. The names were legitimate, the account had a long history, and popularity could not distinguish the poisoned release. Warden's answer is release-level trust: check known-malicious versions, diff the release against the previous one, scan capabilities, block the exact versions.

**Shai-Hulud 2.0, November 2025.** A self-replicating npm worm across 796 packages and 1,092 versions, about 20 million weekly downloads. It added a `preinstall` script, stole credentials, and used compromised publishing access to spread. It could reproduce its own content, making the ecosystem itself the propagation mechanism. Warden's answer is pre-execution interception: detect newly added or changed lifecycle scripts and stop the manager before any script runs.

**react-codeshift agent slopsquat, January 2026.** A plausible name blending `jscodeshift` and `react-codemod` that never existed, traced to a commit with 47 generated agent skill files, propagated to 237 repositories through forks, causing daily execution attempts. Typosquat detection looks for misspellings of a real package; a hallucinated name is a convincing new string. Warden's answer is an agent-aware slopsquat guard over `npx`, `bunx`, and installs, with a machine-readable verdict and an explicit stop condition.

**axios maintainer compromise, March 2026.** Malicious `axios@1.14.1` and `axios@0.30.4` published 39 minutes apart, available about three hours, introducing `plain-crypto-js@4.2.1` with a cross-platform remote access payload. The attacker had published a clean version of the added dependency earlier to build history. The strongest signals were the dependency change and a provenance downgrade to a bare command-line publish. Warden's answer is release comparison: integrity, maintainer and publisher changes, provenance downgrades, new dependencies and capabilities.

## Claims to avoid

- Not "no free supply-chain tools exist" but "existing tools solve fragments; Warden unifies the pre-execution decision across package managers, CI, and coding agents."
- Not "package managers have no security controls" but "native controls reduce exposure; Warden adds cross-manager analysis and one portable verdict."
- Not "Warden prevents every supply-chain attack" but "Warden blocks the attack patterns it detects before package code runs."
- Do not describe roadmap work as shipped, and do not claim a generated explanation makes the decision. Deterministic rules decide the verdict.

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
