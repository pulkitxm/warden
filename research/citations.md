# WNPM — Verified Citations (deck / research)

Every claim below was checked against a primary or vendor source on 2026-07-04.
"Verified" = corroborated by the linked source. Use these exact numbers in the
deck; where a source refines the plan's figure, the refined number is noted.

## CVE publication volume (CVE Program)

- CVE Program metrics list **25,059 published records in 2022**, **28,961 in
  2023**, **40,077 in 2024**, and **48,244 in 2025**. The 2026 Q1 snapshot lists
  **15,176 records**. Prior quarters can be recalculated during the current year,
  while prior years are frozen after year-end reconciliation.
  https://www.cve.org/About/Metrics

## Breach entry points and third parties (Verizon DBIR 2026)

- Verizon reports that exploitation of vulnerabilities became the leading breach
  entry point at **31%**. Breaches involving a third party reached **48%**, a
  **60% increase** over the prior report. The report uses 2025 incident data.
  https://www.verizon.com/about/news/breach-industry-wide-dbir-finds

## npm malware volume (Sonatype)

- **454,648 new malicious open-source packages in 2025**, cumulative >1.233M
  known-blocked across ecosystems; **over 99% of open-source malware is on npm.**
  Sonatype 2026 Software Supply Chain Report.
  https://www.sonatype.com/state-of-the-software-supply-chain/2026/open-source-malware
  https://www.infosecurity-magazine.com/news/454000-malicious-open-source/
- Note: the plan's "75% YoY" figure is from an earlier quarter; Sonatype's later
  framing is a 188% surge vs the same quarter a year prior. Use "454,648 new
  malicious npm-dominant packages in 2025" and skip a specific YoY % unless
  citing a specific quarter. IndonesianFoods alone created >150,000 packages in
  days (industrialized spam campaign).

## LLM package hallucination / slopsquatting (USENIX Security 2025)

- Spracklen et al., "We Have a Package for You!", USENIX Security 2025.
  **576,000 samples across 16 LLMs; 19.7% of recommended packages were
  hallucinations; 205,474 unique fake names.** Range 5.2% (commercial) to 21.7%
  (open-source). **43% of hallucinated names recurred on all 10 reruns, 58% on
  more than one** — the repeatability that makes pre-registration viable.
  https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen
  https://github.com/Spracks/PackageHallucination

## Shai-Hulud 2.0 (Nov 2025)

- Identified **Nov 24, 2025**; self-replicating npm worm, no C2 (reads its own
  content to propagate). **796 unique packages, 1,092 versions, ~20M weekly
  downloads.** Injects `setup_bun.js` + `bun_environment.js` via a new
  **preinstall** script (v1 used postinstall); credential stealer exfiltrating
  via public GitHub repos; ~500 GitHub users / 150 orgs exposed.
  https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/
  https://www.wiz.io/blog/shai-hulud-2-0-aftermath-ongoing-supply-chain-attack
  https://unit42.paloaltonetworks.com/npm-supply-chain-attack/
- Note: the plan's "132M monthly downloads / 25-27k repos" figures come from
  early v2 reporting; Datadog's settled count is 796 pkgs / 1,092 versions /
  ~20M weekly. Prefer the settled numbers.

## chalk / debug hijack (Sept 8, 2025)

- **18 packages, >2 billion weekly downloads combined.** Maintainer (qix) phished
  via fake domain **npmjs.help** (registered Sept 5). Malicious versions live
  **~2 hours**; browser crypto-drainer hooking `window.ethereum`/`fetch` to
  redirect wallet transactions; reached ~1 in 10 cloud environments in the window.
  https://www.aikido.dev/blog/npm-debug-and-chalk-packages-compromised
  https://www.wiz.io/blog/widespread-npm-supply-chain-attack-breaking-down-impact-scope-across-debug-chalk
  https://vercel.com/blog/critical-npm-supply-chain-attack-response-september-8-2025

## axios compromise (Mar 31, 2026)

- Malicious **axios@1.14.1 and 0.30.4** via compromised maintainer account
  (jasonsaayman); two backdoored versions in a **39-minute window**, live **~3
  hours**. Injected dependency **plain-crypto-js@4.2.1** dropping a cross-platform
  RAT. Only meaningful package.json change vs 1.14.0 was the new dependency.
  **Provenance downgrade** (OIDC/SLSA publisher flow → bare CLI publish, changed
  email) is the key tell. Pre-staged ~18h earlier with a clean plain-crypto-js
  4.2.0 to build publishing history. **Attributed to Sapphire Sleet (North
  Korea)** by Microsoft Threat Intelligence; CISA alert Apr 20, 2026.
  https://github.com/axios/axios/issues/10636
  https://www.microsoft.com/en-us/security/blog/2026/04/01/mitigating-the-axios-npm-supply-chain-compromise/
  https://cloud.google.com/blog/topics/threat-intelligence/north-korea-threat-actor-targets-axios-npm-package
  https://www.cisa.gov/news-events/alerts/2026/04/20/supply-chain-compromise-impacts-axios-node-package-manager

## react-codeshift slopsquat (Jan 2026) — the headline agent beat

- Discovered by Aikido's Charlie Eriksen: **react-codeshift**, a plausible
  conflation of real tools **jscodeshift + react-codemod**, name never existed.
  Traced to **a single commit of 47 AI-generated agent skill files, no human
  review**; propagated to **237 repositories** via forks, was translated to
  Japanese, and still received **daily download attempts from autonomous agents**
  until Eriksen defensively claimed the name.
  https://www.aikido.dev/blog/agent-skills-spreading-hallucinated-npx-commands
- Related current threat: "HalluSquatting" (The Hacker News, Jul 2026) and
  reporting that AI coding agents skip package verification.
  https://thehackernews.com/2026/07/new-hallusquatting-attack-could-trick.html

## Ecosystem countermoves (position WNPM above these, not as a duplicate)

- **npm v12 (est. July 2026): install scripts OFF by default**, git/remote-URL
  deps require `--allow-git`/`--allow-remote`.
  https://socket.dev/blog/npm-12
  https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/
- **npm `min-release-age`** (cooldown, days) landed in npm CLI **11.10.0, Feb 2026**.
- **pnpm 11 ships `minimumReleaseAge` enabled at 1440 min (1 day) by default**;
  also `trustPolicy`. Yarn `npmMinimalAgeGate`, Bun `minimumReleaseAge`.
  https://pnpm.io/supply-chain-security
  https://craigory.dev/blog/2026-05-29/package-manager-release-cooldown/
- Framing: WNPM is the **cross-package-manager, agent-aware, verdict-sharing**
  layer above these per-PM cooldowns, and it works on older versions that don't
  have them.

## Assumptions / notes

- The plan cites some figures from early incident reporting (vendor blogs with
  incentives). Where a later settled number exists (Shai-Hulud 2.0 counts, the
  Sonatype YoY framing), this file prefers it and flags the discrepancy so the
  deck isn't caught out by a judge who reads the primary source.
- Attack dates/names/mechanisms are corroborated across multiple independent
  vendors plus CISA and Microsoft; exact impact magnitudes vary by source and
  are labeled where they do.
