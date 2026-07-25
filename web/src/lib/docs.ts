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

[Doctor](/docs/doctor) and [intent](/docs/intent) are the two deepest features. [Agents](/docs/agents) covers the machine-readable surface.
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

Every run also writes \`.warden/last-run.json\`, which is what \`warden fix\` hands to a coding agent.

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
warden fix                               # hand the last failure to an agent
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

\`warden fix\` reads \`.warden/last-run.json\` and produces a bundle for a coding agent, with adapters for Claude, Cursor, Codex, Copilot, Gemini, Aider, and OpenCode. Findings carry both a \`fix\` and a \`verify\` field, so the agent knows the command that proves the fix worked.

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

\`mode\` is one of \`verbose\`, \`brief\`, \`block\`, or \`log\`. \`intercept\` controls whether the shims vet installs and executions. \`agent\` selects which coding agent [\`warden fix\`](/docs/cli/fix) hands off to: \`claude\`, \`cursor\`, \`codex\`, \`copilot\`, \`gemini\`, \`aider\`, or \`opencode\`.

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
| \`.warden/last-run.json\` | Last CI run, read by \`warden fix\` |
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
| Deny dependency scripts | \`ignore-scripts\` | \`strictDepBuilds\`, \`allowBuilds\` | \`enableScripts\` | \`trustedDependencies\` |
| Minimum release age | \`minimum-release-age\` | \`minimumReleaseAge\` | \`minimumReleaseAge\` | Warden |
| Block git and url sources | \`allow-git\`, \`allow-remote\` | \`blockExoticSubdeps\` | Warden | Warden |
| Re-verify the lockfile | Warden | \`trustLockfile\` | \`enableHardenedMode\` | Warden |
| Block downgrades | Warden | \`trustPolicy\` | Warden | Warden |

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

Run \`warden coverage\` for the full matrix of what is mediated, and \`warden integrations doctor\` to check that the shims are actually in front of your tools on this machine.

The backstop for all of it is CI: \`warden ci --require-transaction-receipt\` fails a pull request whose dependency graph changed without a receipt that verifies against the committed lockfile. That check does not depend on anything having worked locally.

## Analysis has limits

- Static analysis reads JavaScript and TypeScript. A native binary, a WebAssembly module, or a compiled artifact is not analyzed the way source is.
- Sufficiently determined obfuscation can hide behaviour from an AST scan. Warden treats heavy obfuscation as a signal in itself, which is a heuristic, not a proof.
- Warden evaluates risk signals and policy. It cannot prove that code is safe. An allow means no rule fired, not that the package is trustworthy.

## Resolution has limits

- Graph resolution is flat: one version per package name. That matches how a hoisting installer usually lands, but a real installer can nest two versions of the same package where Warden reports a conflict instead.
- Git, URL, file, link, workspace, and portal ranges are outside registry resolution. They are reported as unresolved rather than trusted.
- Resolution stops at a node budget and analysis stops at a check budget. Both are reported on the plan, and either one prevents a confident allow.
- The plan describes what the resolver believes will happen. Your package manager remains the thing that actually installs.

## Baselines and history

The comparison baseline is the immediately previous published release. An attacker who publishes two bad releases in a row moves the baseline along with them. Trusted baselines drawn from a known-good release are the better answer and are not implemented yet.

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

export const DOC_PAGES: DocPage[] = [
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
    related: ["doctor", "intent", "agents"],
  },
  {
    slug: "doctor",
    title: "Doctor",
    description:
      "Audit dependencies against OSV, gate every candidate fix through the supply-chain engine, verify in isolation, then apply.",
    section: "Guides",
    body: doctor,
    related: ["concepts", "ci", "security"],
  },
  {
    slug: "intent",
    title: "Intent",
    description:
      "Verify that an agent's diff does what the prompt asked, and catch calls to APIs that do not exist.",
    section: "Guides",
    body: intent,
    related: ["agents", "security"],
  },
  {
    slug: "ci",
    title: "CI",
    description:
      "One command that gates a pull request on dependency changes, lockfile and script edits, and agent intent.",
    section: "Guides",
    body: ci,
    related: ["check-surfaces", "agents", "configuration"],
  },
  {
    slug: "check-surfaces",
    title: "Check surfaces",
    description:
      "Audit the lockfile, install scripts, and registry config: the places trust is lost without any package changing.",
    section: "Guides",
    body: checkSurfaces,
    related: ["ci", "security"],
  },
  {
    slug: "transactions",
    title: "Transactions",
    description:
      "Plan the complete prospective graph, approve exactly what needs approving, apply with scripts suppressed, and leave a receipt CI can verify.",
    section: "Guides",
    body: transactions,
    related: ["policy", "coverage", "limitations"],
  },
  {
    slug: "policy",
    title: "Policy",
    description:
      "One manager-neutral policy compiled into npm, pnpm, Yarn, and Bun's own controls, with every gap named.",
    section: "Guides",
    body: policy,
    related: ["transactions", "configuration"],
  },
  {
    slug: "agents",
    title: "Agents",
    description:
      "The machine-readable surface: JSON on stdout, published schemas, stable exit codes, and the handoff bundle.",
    section: "Guides",
    body: agents,
    related: ["schemas", "intent", "cli"],
  },
  {
    slug: "security",
    title: "Threat model",
    description:
      "The documented incidents behind each rule: axios provenance downgrade, Shai-Hulud preinstall, npmjs.help, lockfile injection, and slopsquatting.",
    section: "Reference",
    body: security,
    related: ["doctor", "check-surfaces"],
  },
  {
    slug: "coverage",
    title: "Command coverage",
    description:
      "Exactly which package-manager commands the shims mediate, generated from the same grammar the shim executes.",
    section: "Reference",
    body: coverage,
    related: ["limitations", "transactions"],
  },
  {
    slug: "limitations",
    title: "Limitations",
    description:
      "What Warden does not cover: shim bypasses, analysis limits, flat resolution, baselines, and what a score is not.",
    section: "Reference",
    body: limitations,
    related: ["security", "coverage", "transactions"],
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
    related: ["configuration", "cli"],
  },
];

export const DOC_SECTIONS = ["Start", "Guides", "Reference"] as const;

export function docBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function commandBySlug(name: string): CommandRef | undefined {
  return COMMANDS.find((command) => command.name === name);
}
