# Market gaps and product mapping

Companion to [citations.md](./citations.md). That file is the verified threat record; this one turns it into product decisions. Checked July 2026.

> These notes live in `research/` rather than `extras/`, because `extras/` is listed in `.gitignore` and anything written there would not be committed.

## 1. Where the ecosystem still leaks

### Lockfile injection is the gap SCA tools admit to

The clearest 2026 development for Warden is that lockfile tampering is now a named, documented technique rather than a theoretical one. Attackers get an innocuous-looking "chore: update dependencies" PR merged where the only meaningful change is a `resolved` URL for a transitive dependency, repointed at a lookalike registry or an attacker-controlled tarball. Software composition analysis reads declared versions, sees no version change, and passes.

This is reinforced by **CVE-2026-50021**: pnpm's tarball extraction worker skips integrity verification when the `integrity` field is *absent* from a lockfile resolution. An attacker who edits `pnpm-lock.yaml` to drop the field, and controls what the registry URL serves, gets altered content installed with no integrity error at all. A missing hash is not a neutral state; it is an exploit precondition.

The remediation the field converged on is exactly a diff-scoped registry-policy check in CI: any PR touching a lockfile's `resolved` or `integrity` field needs review plus an automated gate.

**Warden coverage:** shipped. `warden check lockfile` flags `lockfile_missing_integrity` (block), `lockfile_lookalike_registry` (block), `lockfile_off_registry_host` (block), `lockfile_insecure_transport` (block), plus `sha1` and git/file-path warnings. `warden ci` runs it automatically when a lockfile appears in the merge-base diff. Warden reads npm-format lockfiles today and says so in `notes` for other formats rather than reporting a clean result it did not earn.

**Update:** pnpm and yarn parsing shipped, so CVE-2026-50021's precondition is now detectable in the format it actually affects. Bun lockfiles remain unsupported and say so in `notes`.

### Agents do one check: does the name resolve

The verification gap is now well characterised. Coding agents check whether a name resolves and install if it does. npm's collision detection protects against typosquats of existing names, and provides no defense at all against slopsquats, because a hallucinated name is a brand-new string with nothing to collide with.

The scale is not speculative: 19.7% of LLM-recommended packages were hallucinations across 576k samples and 16 models, 43% of those names recurred on all ten reruns, and in May 2026 researchers found 127 hallucinated names shared *simultaneously* across four different frontier models. Repeatability is what makes pre-registration by an attacker economic.

`react-codeshift` (Jan 2026) is the worked example: a name conflating `jscodeshift` and `react-codemod`, born in a single commit of 47 AI-generated skill files with no human review, spread to 237 repositories, and drawing daily download attempts from autonomous agents.

**Warden coverage:** shipped. `slopsquat` category, curated hallucinated-name intel, `warden intent` hallucinated-API detection, and `wnpx` refusing to execute a blocked package before it runs.

**Remaining gap:** the intel list is curated and static. A documented refresh process with tests matters more than adding rules.

### Install scripts are still the execution primitive

Shai-Hulud 2.0 moved from `postinstall` to `preinstall` and propagated through `setup_bun.js` / `bun_environment.js` across 796 packages. npm v12 turns install scripts off by default, and pnpm 11 ships a one-day `minimumReleaseAge`. Both are real improvements that only help people who have upgraded.

**Warden coverage:** shipped. `warden check scripts` audits the five lifecycle hooks across the installed tree; `install_script` is an engine category; `wnpm install` and doctor's verify step both install with `--ignore-scripts`.

**Deliberate non-goal:** Warden does not try to be a sandbox. It refuses to execute untrusted package code to analyse it, which is why every surface check is static.

### Provenance downgrade is the tell nobody gates on

The axios compromise (Mar 2026, attributed to Sapphire Sleet, CISA alert Apr 20) had almost nothing to detect at the manifest level: the only meaningful `package.json` change versus 1.14.0 was one new dependency. The reliable signal was the *publishing* change, from an OIDC/SLSA trusted-publisher flow to a bare CLI publish with a changed email.

**Warden coverage:** shipped as the `provenance_downgrade` category in `src/diff.ts`.

**Remaining gap:** it is surfaced in verdict JSON but not called out prominently in human output. This is a presentation fix, not an engine one.

## 2. Competitive position

| Tool | Optimises for | What it does not do |
| --- | --- | --- |
| `npm audit` / `bun audit` | Known CVEs in the installed tree | No malware, no typosquat, no install-script analysis; `--force` is notorious for breaking apps |
| OSV-Scanner | Free multi-ecosystem CVE data, 13+ ecosystems | No install interception, no behavioural signals, no repair |
| Snyk | Deep SCA, reachability, enterprise reporting | Commercial; exit codes `0/1/2/3` differ from Warden's `0/10/20/30`; enterprise CLI output can diverge from the platform view |
| Socket | Behavioural reputation, install-time prevention | SaaS-backed; the reputation model is not local or deterministic |
| Dependabot / Renovate | Automated version-bump PRs | **Does not gate the fix**: will happily raise a PR to a version that is itself compromised |
| PM cooldowns (npm 11.10 `min-release-age`, pnpm 11 `minimumReleaseAge`, Yarn, Bun) | Delay exposure to fresh releases | Per-manager, per-version; no verdict sharing; absent on older toolchains |

Snyk shipping `agent-scan` in 2026 confirms the direction of travel: agent components (harnesses, MCP servers, skill files) are now an attack surface in their own right. That validates Warden's agent framing without making Warden redundant, because `agent-scan` inspects agent components while Warden inspects what those agents *install*.

**Warden's defensible position:** local, deterministic, offline-testable verdicts, above per-manager cooldowns and beside CVE scanners, with an agent-native feedback loop and a repair path that gates its own fix. The gate-then-verify loop is the piece no competitor has: Dependabot proposes fixes without vetting them, `npm audit fix --force` applies fixes without verifying them, and Warden refuses a fix that fails the supply-chain gate and reports the dependency as `UNFIXABLE` rather than upgrading into a compromised release.

## 3. Pain to product mapping

| Pain | Who feels it | Existing Warden coverage | Proposed command or gap | Priority | Test strategy |
| --- | --- | --- | --- | --- | --- |
| "The advisory's fixed version is itself compromised" | Human, CI | `doctor` gate + isolated verify | Shipped | n/a | Fixture where the official fix is blocked and the dep is reported UNFIXABLE |
| "`npm audit fix --force` broke my app" | Human | `doctor` verify in an isolated workspace, rollback on failed apply | Shipped | n/a | Apply-rollback test; verify-failure test |
| "CI was green but the lockfile was repointed" | CI | `check lockfile` + `ci` surface gate | Shipped | n/a | Hostile lockfile fixtures per rule; CI gate fires only when the surface is in the diff |
| "CI was green but install ran malware" | CI | `check scripts` + `ci` surface gate | Shipped | n/a | Pipe-to-shell, raw IP, base64, credential-path fixtures |
| "A lookalike registry harvested our token" | Human, CI | `check config` | Shipped | n/a | `npmjs.help` and `npm-js.org` cases; assert the secret is never echoed |
| "My agent installed a package that does not exist" | Agent | `slopsquat`, hallucinated intel, `wnpx` refusal | Shipped | n/a | Curated-name fixtures |
| "Did the agent do what I asked?" | Agent, reviewer | `intent check` | Shipped | n/a | Dropped-claim and scope-creep fixtures |
| pnpm / yarn lockfiles unparsed | Human, CI | `check lockfile` parses npm, pnpm, and yarn | Shipped; Bun lockfiles remain unsupported and are noted | n/a | Real lockfile fixtures per format against the shared rule table |
| Provenance downgrade is buried in JSON | Human | Headline line in human output | Shipped | n/a | Rendered-verdict assertions per headline category |
| Hallucinated-name intel goes stale | Agent | Static curated list | Documented refresh process with tests | Medium | Schema test over the intel file; freshness metadata |
| Unknown verb is a dead end | Human | Closest-verb suggestion in text and JSON | Shipped | n/a | Table of typos to expected suggestion |
| No SARIF output | CI | `ci --reporter sarif` | Shipped | n/a | Structural validation of the document, level mapping, and rule dedup |
| Transitive dependency risk | Human, CI | Direct dependencies only | Depth-limited transitive audit | Low | Deferred; see below |
| Agents cannot call warden as a tool | Agent | CLI with JSON and schemas | `warden mcp` server | Low | Deferred; see below |
| `npm audit` muscle memory | Human | `doctor --no-apply` | `warden audit` alias | Low | Deferred; see below |
| Deep dive on one package | Human | `check --json` carries evidence | `warden explain <pkg>` | Low | Deferred; see below |
| Release cooldown awareness | Human, CI | Age is an engine signal | Surface PM `min-release-age` alignment | Low | Deferred; see below |

## 3a. Deliberately deferred, with reasons

These were considered and not built. Recording why matters more than recording that.

**`warden mcp` server.** An MCP server would let agents call Warden as a tool rather than as a subprocess. The CLI already satisfies the requirement it would serve: JSON on stdout, published schemas, stable exit codes. An MCP server adds a second surface to keep in sync with the registry, and a second place for the contract to drift. Worth building once the CLI surface stops moving, not before.

**`warden audit` as an alias for `doctor --no-apply`.** Tempting because it matches muscle memory, but it invites the assumption that Warden's audit is `npm audit` with a different name. The whole point of doctor is that it gates and verifies the fix, which `npm audit` does not. A familiar name would hide the difference that matters.

**`warden explain <pkg>`.** `warden check --json` already returns the full evidence array, and `--verbose` now prints all of it rather than the first six signals. A separate verb would be a different presentation of data the tool already gives you.

**Cooldown awareness.** Package managers ship their own release-age gates (npm `min-release-age`, pnpm `minimumReleaseAge`, Yarn, Bun). Age already feeds the engine's scoring. Reimplementing a cooldown would duplicate the layer Warden deliberately sits above.

**Transitive dependency auditing.** Doctor audits direct dependencies. Going transitive multiplies both runtime and false-positive surface, and the actionable fix for a transitive problem usually lives in a direct dependency anyway. Revisit if real reports show transitive-only compromises being missed.

## 4. Citation hygiene

Numbers cleared for the website and docs, all from [citations.md](./citations.md):

- CVE Program: 40,077 (2024), 48,244 (2025)
- Sonatype: 454,648 new malicious packages in 2025; over 99% of open-source malware is on npm
- USENIX Security 2025: 19.7% hallucination rate, 205,474 unique fake names, 43% recurring across all ten reruns
- Shai-Hulud 2.0: 796 packages, 1,092 versions, ~20M weekly downloads, `preinstall` injection
- chalk/debug: 18 packages, >2B combined weekly downloads, `npmjs.help` phishing, ~2 hours live
- axios: 1.14.1 and 0.30.4, provenance downgrade as the tell
- react-codeshift: 237 repositories, 47 unreviewed AI-generated skill files

Use settled figures over early vendor reporting, exactly as `citations.md` instructs: prefer Shai-Hulud's 796 packages / ~20M weekly over the early 132M monthly claim, and avoid a bare year-over-year malware percentage.

Needs refresh before reuse:

- The "75% in a single year" malware growth figure still circulating in mid-2026 write-ups conflicts with Sonatype's own later framing. `citations.md` already flags this; do not put a YoY percentage on the site.
- npm v12's install-scripts-off-by-default was estimated for July 2026. Confirm it actually shipped before describing it in the past tense.
- CVE-2026-50021 is cited here from an advisory aggregator. Confirm against the pnpm advisory before it appears on the website.

## Sources

- [Lockfile injection: the npm supply-chain attack your SCA missed](https://pentstark.com/blog/lockfile-injection-supply-chain/)
- [npm Lockfile Integrity: What package-lock.json Protects Against (and What It Doesn't)](https://www.systemshardening.com/articles/cicd/npm-lockfile-integrity-security/)
- [CVE-2026-50021: pnpm integrity check bypass via missing lockfile integrity field](https://advisories.gitlab.com/npm/pnpm/CVE-2026-50021/)
- [The npm Threat Landscape: Attack Surface and Mitigations](https://unit42.paloaltonetworks.com/monitoring-npm-supply-chain-attacks/)
- [AI Coding Agents Skip Package Verification, and Attackers Are Exploiting It](https://www.techtimes.com/articles/319457/20260701/ai-coding-agents-skip-package-verification-attackers-are-exploiting-it.htm)
- [New HalluSquatting Attack Could Trick AI Coding Assistants Into Installing Botnet Malware](https://thehackernews.com/2026/07/new-hallusquatting-attack-could-trick.html)
- [Slopsquatting: The AI Package Hallucination Attack Already Happening](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)
- [Top AIs invent same fake PyPI and npm package names](https://www.infoworld.com/article/4200884/top-ais-invent-same-fake-pypl-and-npm-package-names.html)
- [snyk/agent-scan](https://github.com/snyk/agent-scan)
- [Snyk CLI JSON output format](https://safeguard.sh/resources/blog/how-the-snyk-clis-json-output-format-supports-custom-tooling-and-reporting)
