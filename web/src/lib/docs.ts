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
curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh
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

\`\`\`text
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
| \`package-lock.json\`, \`npm-shrinkwrap.json\` | [lockfile](/docs/check-surfaces) |
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

Every run also writes \`.warden/last-run.json\`, which is what \`warden fix\` hands to a coding agent.

## Policy

\`warden.config.json\` can set \`ci.failOn\` to \`warn\` to treat warnings as blocking.

## Workflow

\`\`\`yaml
- uses: oven-sh/setup-bun@v2
- run: curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh
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

Reads \`package-lock.json\` or \`npm-shrinkwrap.json\`. Other formats are reported as unsupported in \`notes\` rather than being treated as clean.

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
\`\`\`

\`mode\` is one of \`verbose\`, \`brief\`, \`block\`, or \`log\`. \`intercept\` controls whether the shims vet installs and executions.

## Project config

\`warden.config.json\` at the repository root:

\`\`\`json
{ "ci": { "failOn": "block" } }
\`\`\`

\`ci.failOn\` accepts \`block\` (default) or \`warn\`. With \`warn\`, warnings become blocking in [\`warden ci\`](/docs/ci).

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
