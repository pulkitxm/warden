# Warden presentation context

This document is the narrative behind the presentation. Use it as speaker notes, a source for future slides, or a briefing document for anyone presenting Warden.

## The one-sentence story

Warden is a free, open-source trust layer that checks a package before a developer, package manager, CI job, or coding agent is allowed to install or execute it.

## The problem in plain language

Modern software development treats package installation as a routine operation, but an install can execute code with the developer's permissions. That code may have access to environment variables, source code, cloud credentials, SSH keys, package registry tokens, and the network.

The dangerous moment is not after a vulnerability scanner reports a problem. It is the instant between requesting a package and allowing that package to run.

Three changes have made that moment much riskier:

1. Popular packages are attractive takeover targets. An attacker who compromises one maintainer account can reach millions of systems through a trusted name.
2. Malicious releases move faster than manual review. Some recent attacks were available for only a few hours, but package managers and automated pipelines could install them immediately.
3. Coding agents install and execute packages autonomously. They can repeat commands from repository instructions, generated skill files, documentation, and previous outputs without independently proving that a package is real or safe.

The scale is already large. Sonatype reported 454,648 new malicious open-source packages in 2025. A USENIX Security 2025 study tested 576,000 package recommendations across 16 language models and found that 19.7 percent were hallucinated, producing 205,474 unique package names. Forty-three percent of the hallucinated names appeared in every repeated run, making those names predictable enough for attackers to register in advance.

The core question is simple:

> Why can an untrusted package execute before it receives a security verdict?

Warden changes the default sequence from `request, download, execute, investigate` to `request, inspect, decide, execute only if allowed`.

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

## The common pattern

The attacks differ, but the security gap is consistent:

| Incident | Trust signal that failed | What had to be checked |
|---|---|---|
| chalk and debug | Trusted maintainer and popular package | Exact version and changed behavior |
| Shai-Hulud 2.0 | Normal dependency installation | Lifecycle scripts and credential access before execution |
| react-codeshift | Plausible command in repository instructions | Whether the package name was real and trustworthy |
| axios | Trusted project name and established history | Provenance, publisher identity, release diff, and new dependency |

The ecosystem usually evaluates these signals in separate places and at different times. Warden evaluates them at the point where a decision is still useful: before execution.

## What current products solve, and what remains unsolved

The presentation should not claim that no free or open-source security tools exist. Several strong tools solve important parts of the problem:

| Existing approach | What it does well | Remaining gap |
|---|---|---|
| Native package-manager controls | Disable or approve scripts, enforce minimum release age, and harden lockfile behavior | Controls differ by manager and version, and they do not provide one behavioral verdict across every workflow |
| Vulnerability scanners such as OSV-Scanner | Find dependencies with known published vulnerabilities across many lockfile formats | Primarily answer whether a known vulnerability affects an existing dependency, not whether a newly published package is malicious before first execution |
| Open-source malicious-package scanners such as GuardDog | Analyze package source and metadata with malicious-code heuristics | Require an explicit scan and are not a transparent package-manager checkpoint or an agent feedback loop |
| Commercial supply-chain platforms | Provide broad intelligence, dashboards, repository integrations, and organization policy | Core protection often depends on a hosted account, commercial plan, or vendor service, and the workflow is not always local or portable |
| Registry and ecosystem blocklists | Quickly stop already identified malicious packages | React after discovery and cannot cover an unseen malicious release or a newly registered slopsquat on their own |

The defensible market gap is narrower and stronger:

> No existing free, open-source tool combines transparent pre-execution interception across npm, pnpm, Yarn, Bun, `npx`, and `bunx` with release diffing, behavioral package analysis, deterministic verdicts, CI enforcement, and a first-class coding-agent contract.

This is the problem Warden is designed to solve. It is not another dashboard and it is not a replacement package manager. It is a portable checkpoint that works with the tools a developer already uses.

## Why open source and free matter

A package trust boundary should not depend on whether an individual developer, student, maintainer, or small team can afford a security subscription.

Open source provides four practical benefits:

1. Anyone can inspect the rules that decide whether a package is allowed or blocked.
2. Researchers can add detections for new campaigns without waiting for a private vendor roadmap.
3. Teams can run the decision locally and keep source, package metadata, and policy inside their environment.
4. Every coding agent can consume the same stable verdict without requiring a separate paid seat or hosted integration.

Warden uses deterministic rules for the security decision. An optional generated explanation may rewrite the human summary, but it cannot change the allow, warn, or block verdict. This keeps the trust boundary reviewable, testable, and reproducible.

## What Warden does today

Warden already provides the core end-to-end path shown in the deck:

- `warden check` resolves a package, verifies tarball integrity, compares releases, scans JavaScript capabilities, checks names and curated intelligence, and returns allow, warn, or block.
- Transparent shims intercept install and execute commands from npm, pnpm, Yarn, Bun, `npx`, and `bunx` while passing unrelated commands through unchanged.
- Protect mode blocks risky execution. Observe mode records verdicts without blocking.
- `warden ci` evaluates changed dependencies against the merge base and emits human, JSON, workflow, or agent-oriented output.
- `warden detect` maps the workspace and its package manager, framework, role, and tooling with evidence.
- `warden init` writes repository configuration, CI wiring, hooks, and agent context.
- `warden fix` writes a structured handoff for the configured coding agent.
- Stable exit codes provide an unambiguous contract: `0` allow, `10` warn, `20` block, and `30` analysis error.

The current engine detects:

- known malicious package versions
- typosquats, homoglyphs, scoped impersonation, and known hallucinated names
- new or changed lifecycle scripts
- provenance, maintainer, and publisher changes
- environment and sensitive-file access
- cloud metadata access
- network, DNS, and raw-IP egress
- shell execution and reverse-shell behavior
- destructive filesystem operations
- obfuscation combined with execution or network capability

## First-class support for coding agents

Agent support is not a label placed on human-readable terminal output. It changes the product contract.

### 1. Agents receive structured decisions

Every verdict has a versioned schema, stable fields, and stable exit codes. Agents branch on `verdict` and `error.kind` instead of scraping prose.

### 2. Agents receive evidence and an action

The agent reporter includes the rule, package, file, line, evidence, concrete fix, verification command, and whether the finding has appeared before. The agent does not need to repeat the security investigation before making a safe change.

### 3. Untrusted package text is treated as data

Package descriptions, script bodies, and other registry-controlled strings can contain hostile instructions. Agent-facing output keeps untrusted content separate and sanitized so the security tool does not become a prompt-injection path.

### 4. The handoff closes the loop

`warden fix` writes `.warden/handoff.json` with the finding, repository context, constraints, recheck commands, and a final verification command. The selected agent fixes the dependency and runs `warden ci --reporter agent`. The task is complete only when Warden returns a clean verdict.

### 5. Agents are protected at the command boundary

The same shims that protect a person also protect an autonomous process. If an agent attempts `npm install`, `npx`, `bunx`, or an equivalent command, the request crosses Warden before the package manager can execute the package.

### 6. The interface is portable

Warden includes adapters for seven major coding-agent CLIs and can print a generic handoff for any other agent. The security decision remains independent of the agent vendor.

The resulting loop is:

`agent requests package` -> `Warden inspects` -> `deterministic verdict` -> `agent fixes or proceeds` -> `Warden verifies`

## How to explain the deck slide by slide

### Slide 1: Nothing runs without a verdict

Open with the outcome, not the implementation. Package installation has become code execution, so Warden introduces a checkpoint before trust is granted.

### Slide 2: The package is the payload

Use the figures to establish scale. The key transition is from known vulnerabilities to malicious packages and predictable hallucinated package names.

### Slide 3: One command enters, evidence decides what leaves

Explain that no single weak signal blocks a package. Warden resolves identity, verifies integrity, compares releases, scans capabilities, combines threat intelligence with deterministic rules, and then returns a verdict.

### Slide 4: Live package check

Emphasize that the package is blocked before its lifecycle script runs. Exit code 20 makes the same decision enforceable by a terminal, shell script, CI job, or coding agent.

### Slide 5: No habit change

The developer keeps using the original package manager. Warden is a transparent trust layer, not a migration to another ecosystem.

### Slide 6: One-time setup

Installation produces local binaries and shims. Checksums protect the installation path, while local configuration lets the user choose protect or observe behavior.

### Slide 7: One trust layer, every workflow

Connect the verbs to a lifecycle: check a package, inspect a repository, initialize policy, enforce changes in CI, hand a finding to an agent, and review recorded decisions.

### Slide 8: Pull request gate

Show how the same local verdict becomes a merge decision. Warden evaluates only changed dependencies and reports the exact package, file, line, evidence, and fix.

### Slide 9: Agent-first guardrail

This is the product distinction. The agent gets structured evidence, a safe action, and a verification command. It does not receive an ambiguous log and permission to guess.

### Slide 10: Recent incidents

Present the attacks as a progression:

1. chalk and debug show that trusted accounts can be hijacked.
2. Shai-Hulud shows that install scripts can turn the ecosystem into a worm network.
3. axios shows that provenance and dependency changes matter even when the package name remains trusted.
4. Add `react-codeshift` verbally as the bridge to the agent threat: a nonexistent package command propagated through repository instructions.

### Slide 11: From package gate to repository shield

Be explicit that the package gate, shims, CI dependency checks, and agent handoff exist today. Broader lockfile, registry configuration, repository policy, secret, license, and MCP coverage are expansion areas.

### Slide 12: Keep the workflow, add the checkpoint

Close on adoption. Developers retain their package managers and agents. Warden adds one consistent decision boundary across local work and CI.

## Suggested two-minute problem narrative

"A package install is not just a download. It can execute code with access to a developer's environment, credentials, repository, and network. Recent attacks exploited four different assumptions. The chalk and debug compromise used trusted package names and a trusted maintainer account. Shai-Hulud used lifecycle scripts to steal credentials and replicate across packages. The axios compromise hid behind a legitimate project while its publishing provenance and dependency graph changed. At the same time, `react-codeshift` showed a new failure mode: coding agents repeatedly attempted to execute a package name invented in generated repository instructions.

Existing tools cover parts of this. Package managers can disable scripts or delay new releases. Vulnerability scanners find known CVEs. Malicious-package scanners analyze code. Commercial platforms add intelligence and dashboards. What is missing is one free, open-source checkpoint that works before execution across package managers, CI, and coding agents.

Warden sits at that boundary. It verifies the tarball, compares the release with its predecessor, scans behavior, checks threat intelligence and naming risk, and produces a deterministic allow, warn, or block verdict. Humans see the reason. CI receives a stable exit code. Coding agents receive structured evidence, a fix, and a command that proves the repository is clean. The workflow stays the same. The unsafe default changes."

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
