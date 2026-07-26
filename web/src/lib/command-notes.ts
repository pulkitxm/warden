export interface CommandExample {
  command: string;
  description: string;
}

export interface CommandNote {
  intro: string;
  whenToUse: string[];
  examples: CommandExample[];
  behaviour?: string;
  gotchas?: string[];
}

export const COMMAND_NOTES: Record<string, CommandNote> = {
  check: {
    intro:
      "The front door. `warden check` answers one question before anything is installed: should this run? It resolves the package from the registry, verifies the tarball against its integrity hash, parses the code with an AST scan rather than executing it, compares the release against the version before it, and returns a verdict with the evidence behind it.",
    whenToUse: [
      "Before adding a dependency you have not used before, especially one an agent suggested.",
      "In a script or agent loop, with `--json`, branching on the exit code rather than the text.",
      "Against your own repository, using the `lockfile`, `scripts`, and `config` surfaces, to catch trust problems that live in your files rather than in a published tarball.",
    ],
    examples: [
      { command: "warden check express@5", description: "Vet one package at an exact version." },
      {
        command: "warden check left-pad chalk debug --json",
        description:
          "Vet several in parallel. With more than one package the JSON output is an array, so an agent can map over it.",
      },
      {
        command: "warden check lockfile --json",
        description:
          "Audit where every dependency actually resolves from. Catches a rewritten `resolved` URL that changes no version number.",
      },
      {
        command: "warden check scripts",
        description:
          "Audit the five npm lifecycle hooks across the installed tree. This is the Shai-Hulud surface.",
      },
      {
        command: "warden check config",
        description:
          "Audit `.npmrc` in the project and your home directory for lookalike registries and plaintext tokens. Values are never echoed back.",
      },
    ],
    behaviour:
      "Nothing from the package is executed. The engine reads the tarball, walks the AST for dangerous capabilities, measures the name against real download popularity for typosquat distance, and checks curated malware and hallucination intel. A verdict is cached by integrity hash, so a repeat check of the same artifact is instant and offline.",
    gotchas: [
      "`--allow-risky` downgrades a block to exit `10`; it does not make the package safe, and the evidence is still printed.",
      "A surface check (`lockfile`, `scripts`, `config`) takes no other positional arguments. Combining them with a package name is rejected rather than silently ignored.",
      "Exit `30` means the analysis could not complete, which is deliberately different from exit `20`.",
    ],
  },

  plan: {
    intro:
      "The transaction verb. `warden plan` resolves the complete prospective dependency graph, without running a single line of package code, diffs it against what is installed today, vets every added or changed package, and returns one decision for the whole change rather than a verdict per package name you happened to type.",
    whenToUse: [
      "Before adding a dependency, to see what actually enters the graph rather than only what you asked for.",
      "In an agent loop, with `--json`, as the gate that decides whether the install proceeds at all.",
      "When an install feels larger than it should, to see the transitive additions and the install scripts they carry.",
    ],
    examples: [
      {
        command: "warden plan -- npm install @fastify/jwt",
        description: "Plan a specific install. The command after `--` is read, not executed.",
      },
      {
        command: "warden plan",
        description:
          "Plan the whole manifest as one graph transaction, which is what a bare `npm install` really is.",
      },
      {
        command: "warden plan --json -- pnpm add zod",
        description: "The machine-readable transaction plan, including both graph digests.",
      },
    ],
    behaviour:
      "Resolution has two paths and the plan says which one it used in its `resolver` field. When your package manager is on `PATH` and can resolve without downloading, Warden copies the manifest, lockfile, and registry config into a throwaway directory and lets that manager's own solver pick the versions. Otherwise Warden walks registry metadata itself, choosing one version per package. Nothing is downloaded, unpacked, or executed either way, and changed packages are described from their registry manifests on both paths. The delta names additions, version moves, removals, the packages that carry install scripts, and specifically which of those scripts are new relative to the graph you already trust. Every added or changed package is then vetted through the same engine as `warden check`. The plan is written to `.warden/plans/` under an id derived from the command and the resulting graph, so the same change always produces the same plan id, along with the `request` that produced it so `warden apply` can replay exactly that command.",
    gotchas: [
      "The decision is `NEEDS_APPROVAL`, not `ALLOW`, whenever new install scripts appear, the graph was truncated, or some changed packages fell outside the analysis budget. Warden reports incomplete coverage rather than implying it checked everything.",
      "A manager-resolved graph knows which versions would be installed but not which dependents asked for them, so `requiredBy` is empty, every node sits at depth 1, and `conflicts` is always empty on that path. The execution surface is unaffected: changed packages are described from their registry manifests either way.",
      "A requirement that does not resolve from the registry blocks the transaction. Failing open on a resolution error would defeat the point of planning.",
      "Git, URL, file, link, and workspace ranges are outside registry resolution and are reported as unresolved rather than silently trusted.",
      "The plan describes what the resolver believes will happen. The package manager remains the thing that actually installs, which is why the receipt verified in CI matters.",
    ],
  },

  apply: {
    intro:
      "Executes a plan that has already been decided. `warden apply` installs with lifecycle scripts suppressed at the package manager level, refuses to proceed while any new install script is unapproved, runs the project's own verification, restores the root manifest on failure, and writes a transaction receipt.",
    whenToUse: [
      "After `warden plan` returned a decision you accept.",
      "In an agent loop, as the only step permitted to change the dependency graph.",
      "When you want an installation whose outcome is recorded rather than assumed.",
    ],
    examples: [
      {
        command: "warden apply wtxn_8f2eb19ab77eb529",
        description: "Apply a plan by its id.",
      },
      {
        command: "warden apply wtxn_8f2eb19ab77eb529 --no-verify",
        description: "Install without running the project's test, typecheck, and build scripts.",
      },
      {
        command: "warden apply wtxn_8f2eb19ab77eb529 --json",
        description: "The receipt on stdout, for CI or an agent to store.",
      },
    ],
    behaviour:
      "The install is a replay of the request the plan recorded, not a reconstructed command, so what runs is what was planned. Scripts stay suppressed for the whole install, including for packages whose scripts are approved: approval governs whether the transaction may proceed, not whether Warden hands execution to arbitrary code mid-install. Suppression uses each manager's own mechanism. After a successful install the project's `test`, `typecheck`, and `build` scripts run in that order, stopping at the first failure. Warden then digests the graph that actually landed and records it as `observed_graph`. Any failure, or an observed graph that is not the one the plan reviewed, restores the manifest and every lockfile. The receipt lands in `.warden/receipts/` and is mirrored to `.warden/last-receipt.json`.",
    gotchas: [
      "A blocked plan is refused outright. There is no flag that turns a block into an install.",
      "A plan is refused when the project's graph has moved since it was made. Re-plan, or pass `--allow-stale-plan` if you know why it moved.",
      "Failure restores `package.json` and every lockfile. It does not restore `node_modules` or anything project verification touched, so this is not a full transaction rollback. Staged application is the fix and is not built yet.",
      "A plan is also refused when the graph was truncated or any changed package went unanalyzed. A script approval does not cover incomplete analysis.",
      "`--skip-script-approval` proceeds past missing script approvals. It does not run the script: nothing warden applies ever runs a package's install script. The receipt names the exception under `exceptions`, so the bypass is visible afterwards.",
      "The plan must still be on disk. Re-run `warden plan` if `.warden/plans/` was cleaned.",
    ],
  },

  "approve-script": {
    intro:
      "A narrow, revocable approval for exactly one lifecycle script. It replaces the blunt instrument of allowing risk in general with a record of what was reviewed: this package, at this version, from this tarball, at this hook, with this script body.",
    whenToUse: [
      "When a plan reports `NEEDS_APPROVAL` and you have read the script it names.",
      "For a build tool your project genuinely needs to compile a native binary at install time.",
      "In a repository where the same approvals should apply to every contributor, using the repo scope.",
    ],
    examples: [
      {
        command: "warden approve-script esbuild@0.25.8 --hook postinstall",
        description: "Approve one hook of one exact version for this repository.",
      },
      {
        command: "warden approve-script sharp@0.33.5 --hook install --scope user",
        description: "Approve for your machine rather than for the repository.",
      },
      {
        command:
          'warden approve-script esbuild@0.25.8 --hook postinstall --note "reviewed in PR 412"',
        description: "Record why the approval exists, which is what makes it auditable later.",
      },
    ],
    behaviour:
      "The approval binds the package name, exact version, tarball integrity, hook name, and a hash of the normalized script body. Any change to any of those voids it, so a version bump or a republished tarball asks again rather than inheriting trust. Repo approvals live in `.warden/approvals.json` and are meant to be committed; user approvals live under your home directory.",
    gotchas: [
      "Approval is not execution. Warden still installs with scripts suppressed; the approval is what allows the transaction to proceed at all.",
      "Only an exact published version can be approved. A range would defeat the point.",
      "Re-approving the same package and hook replaces the previous record rather than stacking a second one.",
    ],
  },

  verify: {
    intro:
      "Checks that the dependency graph sitting in the repository is the one a Warden transaction actually produced. This is the backstop for the honest admission that PATH shims can be bypassed: whatever happened locally, CI can still ask whether the committed graph carries a valid receipt.",
    whenToUse: [
      "In CI, through `warden ci --require-transaction-receipt`, on every pull request that touches dependencies.",
      "After pulling a branch, to see whether its lockfile matches a recorded transaction.",
      "When auditing a change after the fact and the local history is gone.",
    ],
    examples: [
      { command: "warden verify", description: "Verify the most recent receipt." },
      {
        command: "warden verify wtxn_acb0875bfa27e1ebfa8caeaf",
        description: "Verify one specific transaction by id.",
      },
      { command: "warden verify --json", description: "The machine-readable verification report." },
    ],
    behaviour:
      "The installed graph is digested from the lockfile and compared against the `graph_after` the receipt records. The policy digest is compared against the plan still on disk when one is present. The receipt's own result and verification steps are checked, and any artifact that was never analyzed fails coverage. All five checks must hold for the transaction to verify.",
    gotchas: [
      "A verified receipt says the committed graph matches a recorded, analyzed transaction. It does not prove that nothing ran outside Warden on the developer's machine.",
      "Exit `20` means a mismatch, which is deliberately the same code as a blocked package: both mean do not merge this.",
    ],
  },

  install: {
    intro:
      "The short way to add a dependency through Warden. `warden install` vets every package first, refuses on a block, and then hands the install to your own package manager with lifecycle scripts suppressed. It is the same path as `wnpm install`, under the verb people reach for.",
    whenToUse: [
      "Adding a package you have not used before, when you want the vetting without setting up the shims.",
      "In a container, a CI job, or an agent loop, where a single binary is easier to reason about than a shim on PATH.",
      "When the project's manager is not the one you want to install with, using `--npm`, `--pnpm`, `--yarn`, or `--bun`.",
    ],
    examples: [
      {
        command: "warden install express",
        description: "Vet, then install with the detected manager.",
      },
      {
        command: "warden install --bun express",
        description: "Install with Bun regardless of what the project looks like.",
      },
      {
        command: "warden i left-pad chalk --json",
        description: "The verdicts as JSON. `i` and `add` are aliases of `install`.",
      },
    ],
    behaviour:
      "Named packages are vetted in parallel, eight at a time; with no names, the direct dependencies in `package.json` are vetted instead. A single `block` stops the install before anything is downloaded or executed. The install itself runs through npm, pnpm, Yarn, or Bun with that manager's own script suppression, and the shims, if installed, still gate the resulting graph transaction.",
    gotchas: [
      "This is a vetted install, not a transaction: it does not write a plan or a receipt. Use `warden plan` and `warden apply` when you want the graph decision and the receipt.",
      "The manager flag chooses the manager, it does not install that manager. A missing one is reported rather than silently swapped.",
    ],
  },

  policy: {
    intro:
      "Package managers have been growing real security controls of their own: npm has script approvals and source restrictions, pnpm 11 has build allowlists and a release age gate, Yarn disables dependency postinstalls by default, Bun runs nothing outside `trustedDependencies`. Warden does not duplicate them. `warden policy` takes one manager-neutral intent and compiles it into the strongest primitive each manager actually has.",
    whenToUse: [
      "When adopting Warden in a repository, to see what your package manager can enforce by itself.",
      "When switching package managers, to see which guarantees you keep and which move to Warden.",
      "In a setup script, with `--json`, to write the native settings automatically.",
    ],
    examples: [
      {
        command: "warden policy",
        description: "Compile for the manager this project actually declares.",
      },
      {
        command: "warden policy --manager pnpm",
        description: "Compile for a specific manager, whatever the project uses.",
      },
      {
        command: "warden policy --json",
        description: "The compiled settings, the gaps, and what Warden enforces itself.",
      },
    ],
    behaviour:
      "The policy has five parts: whether dependency scripts run, a minimum release age, whether git and url sources are allowed, whether the lockfile is re-verified, and whether downgrades are permitted. Each compiles differently. pnpm expresses all five natively. npm covers scripts, release age, and sources. Yarn covers scripts, release age, and hardened mode. Bun covers only scripts. Every intent a manager cannot express is listed explicitly alongside how Warden enforces it instead.",
    gotchas: [
      "Compiling prints the settings; it does not write them into your config files. What to change is your decision, and the files often carry unrelated settings.",
      "Native controls are still evolving across all four managers. A setting listed here reflects the documented behaviour of current releases, not a guarantee about older ones.",
      "Set the policy under `policy` in `warden.config.json`. Anything you leave out inherits the default, which denies unapproved scripts and gates releases younger than a day.",
    ],
  },

  explain: {
    intro:
      "A verdict is only useful if you can act on it. `warden explain` answers the four questions a person actually has: what changed, why that matters here, what Warden prevented, and what to do next. It leads with the decision, the confidence, and the reason codes rather than with a number.",
    whenToUse: [
      "When a check or a plan blocked something and you need to decide what to do.",
      "When a warning looks like a false positive and you want the evidence behind it.",
      "In an agent loop, with `--json`, to turn a block into a next action instead of a dead end.",
    ],
    examples: [
      {
        command: "warden explain left-pad@1.3.0",
        description: "Explain one exact release.",
      },
      {
        command: "warden explain react-codeshift --json",
        description: "The structured explanation, including reason codes and the baseline used.",
      },
    ],
    behaviour:
      "The decision and the confidence come first. Confidence is high for a blocklist hit or for known malware, high for a fresh clean analysis, medium for a cached allow, and lower for a block that rests on a single signal. Every reason code is translated into plain language. A block states what did not happen, because that is what blocking bought you. The next action is specific: compare against a package you trust, read the release history, approve one script narrowly, or plan the install.",
    gotchas: [
      "The score is still reported, labelled as a heuristic score. It is a summary of weighted signals, not a calibrated probability, and it is deliberately not the headline.",
      "The baseline is named. Today it is the previous published release, so an attacker who publishes two bad releases in a row shifts the baseline.",
      "A name that is not on the registry is reported as unpublished rather than as a first release.",
    ],
  },

  history: {
    intro:
      "Shows how a package changed across releases in the ways that matter for trust: who published it, whether provenance held, which lifecycle scripts appeared, and whether it was deprecated.",
    whenToUse: [
      "When deciding whether a version bump is routine or worth reading.",
      "After an incident, to see when a package's publishing behaviour changed.",
      "Before adopting an unfamiliar dependency.",
    ],
    examples: [
      { command: "warden history left-pad", description: "The recent release history." },
      { command: "warden history esbuild --tail 5", description: "Only the last five releases." },
      { command: "warden history chalk --json", description: "The structured history." },
    ],
    behaviour:
      "Releases are listed newest first. The current release is annotated with what changed relative to the one before it: a changed publisher email, lost provenance attestation, newly added lifecycle scripts, or deprecation.",
    gotchas: [
      "A name that is not published is an error, not an empty history. A missing package is itself a finding.",
    ],
  },

  compare: {
    intro:
      "When a package is blocked, the real question is what to use instead. `warden compare` puts candidates side by side on evidence: verdict, popularity, age, provenance, install scripts, and deprecation.",
    whenToUse: [
      "After a block, to find an established package that does the same job.",
      "When an agent proposes a dependency you have never heard of.",
      "When choosing between two libraries and trust is part of the decision.",
    ],
    examples: [
      {
        command: "warden compare jscodeshift react-codemod",
        description: "Compare two candidates on the evidence.",
      },
      {
        command: "warden compare react-codeshift jscodeshift --json",
        description: "The structured comparison, ordered best first.",
      },
    ],
    behaviour:
      "Each candidate is vetted and its registry metadata read. Ranking penalises a block heavily, then an unanalyzable candidate, then deprecation, then install scripts, and rewards provenance and real download volume. A candidate that could not be analyzed appears as unknown rather than being dropped.",
    gotchas: [
      "Ordering is a summary of evidence, not an endorsement. Warden never installs an alternative for you, and it never picks one on the strength of a model's opinion alone.",
    ],
  },

  scripts: {
    intro:
      "Lists every lifecycle script in the graph you already have installed, and which of them are still waiting on an approval. This is the standing view of your execution surface, as opposed to the per-transaction view a plan gives you.",
    whenToUse: [
      "After adopting Warden in an existing repository, to see the surface you inherited.",
      "Before turning on stricter policy, to see how much approval work it implies.",
      "In CI or a pre-commit check, with `--json`, to keep the pending set at zero.",
    ],
    examples: [
      { command: "warden scripts pending", description: "The install scripts and their status." },
      { command: "warden scripts pending --json", description: "The structured inventory." },
    ],
    behaviour:
      "The installed graph is read from the lockfile and each package's own manifest under `node_modules`, so this reflects what is really on disk rather than what the registry currently says. Each hook is matched against the approvals in the repository and in your home directory. The command exits `10` while anything is pending and `0` once every script is approved.",
    gotchas: [
      "Pending does not mean the script ran. Warden suppresses scripts at install time; this list is what would need approval before a transaction involving them can proceed.",
      "A package whose manifest cannot be read has no recorded hooks, so it will not appear here.",
    ],
  },

  agent: {
    intro:
      "Coding agents are the reason Warden exists in its current shape, and they need three layers, not one: guidance so the agent chooses the right workflow, hooks so a package-manager command is mediated when it actually runs, and a CI receipt gate that no agent can skip. `warden agent` sets those up and tells you honestly which ones a given agent genuinely supports.",
    whenToUse: [
      "Once per repository, after installing Warden, to wire up the agents your team uses.",
      "When adding a new agent to a project, to see what it can and cannot enforce.",
      "To print the MCP tool manifest for an agent that supports MCP.",
    ],
    examples: [
      {
        command: "warden agent doctor",
        description: "Which agents are installed, which are configured, and what is still pending.",
      },
      {
        command: "warden agent setup claude --yes",
        description: "Write the instruction section and the skill for one agent.",
      },
      { command: "warden agent setup --all", description: "Plan the adapters for every agent." },
      {
        command: "warden agent mcp --json",
        description: "The MCP tool manifest, generated from the same command registry as the CLI.",
      },
    ],
    behaviour:
      "Adapters are capability-based rather than a list of launch commands. Each agent declares whether it genuinely supports an instruction file, a skill, a pre-command hook, a post-change hook, MCP, and managed settings. Claude Code and Codex are the two with real command interception; the rest fall back to the PATH shim and the CI receipt gate, and the report says so rather than implying equal integration. Setup plans before it writes, appends rather than overwrites, and stamps a version marker so a second run is a no-op.",
    gotchas: [
      "Hook and MCP configuration are never rewritten for you. Those files usually carry settings Warden does not own, so the command tells you what to merge and leaves the merge to you.",
      "The MCP surface is read-only by design. `plan`, `explain`, `compare`, `check`, and the other reporting verbs are exposed; `apply`, `approve-script`, `init`, and `config` are not, and the manifest names each exclusion with its reason.",
      "Every tool is generated from the command registry, so the MCP surface cannot drift from the CLI.",
      "Guidance is guidance. An agent that ignores its instruction file is still caught by the shim, and one that bypasses the shim is still caught by `warden ci --require-transaction-receipt`.",
    ],
  },

  baseline: {
    intro:
      "A version delta is only as good as what it is measured against. Comparing a release to the one published immediately before it is the weakest possible baseline: an attacker who publishes twice moves the comparison point along with them. `warden baseline` records the version you actually trust, so a delta means something.",
    whenToUse: [
      "After auditing a dependency, to pin the exact version that audit covered.",
      "When adopting Warden in an existing project, to see what each baseline currently rests on.",
      "Before an upgrade, to check whether the comparison point is strong or a fallback.",
    ],
    examples: [
      { command: "warden baseline list", description: "Every baseline and how much it is worth." },
      {
        command: 'warden baseline record esbuild@0.25.8 --note "audited in PR 412"',
        description: "Pin an exact version as trusted, with the reason.",
      },
      { command: "warden baseline list --json", description: "The structured baselines." },
    ],
    behaviour:
      "Baselines resolve in order of how much evidence stands behind them: an explicitly recorded version, then the version a verified Warden transaction installed, then the version in your lockfile, then the previous published release. Each is graded strong, moderate, weak, or none, and carries the evidence that produced it. Recorded baselines live in `.warden/baselines.json` and are meant to be committed.",
    gotchas: [
      "A baseline must name an exact version. A range would defeat the purpose.",
      "Only an applied receipt with an allow verdict contributes a baseline. A refused transaction or a blocked artifact does not.",
      "Recording a baseline does not re-run any analysis. It changes what future deltas are compared against.",
    ],
  },

  benchmark: {
    intro:
      "A security tool that publishes a detection rate without publishing the corpus behind it is asking to be taken on faith. `warden benchmark` runs a curated corpus of attack and benign dependency shapes through the same resolver and the same decision logic the CLI uses, and reports detection, false positives, and analysis coverage together.",
    whenToUse: [
      "Before trusting the tool, to see what it actually catches and what it lets through.",
      "In CI on this repository, to catch a change that quietly weakens a decision.",
      "When tuning policy, to see the false-positive cost of a stricter setting.",
    ],
    examples: [
      { command: "warden benchmark", description: "The human summary and any regressed case." },
      {
        command: "warden benchmark --json",
        description: "The full report, including every case and the method behind the numbers.",
      },
    ],
    behaviour:
      "Every case is driven through the real resolver and the real plan decision, not a mock. A malicious shape counts as caught only when the decision stops the install, which means block or needs approval. A benign shape counts as a false positive when the decision stops it. The command exits `20` if any case no longer matches its recorded decision, so a weakened rule fails the build rather than moving the average.",
    gotchas: [
      "These are curated shapes, not a sample of the registry. Treat the rates as regression signals, not as field accuracy.",
      "The published figures are at [warden.pulkit.page/benchmark](/benchmark), generated from the same run.",
    ],
  },

  coverage: {
    intro:
      "Publishes exactly which package-manager commands Warden mediates, and which it does not. A security tool earns trust through verifiable coverage rather than a claim, so this matrix is generated from the same grammar the shim executes.",
    whenToUse: [
      "Before trusting the shims, to see what is actually protected.",
      "When a command you expected to be checked was not.",
      "In CI or an audit, with `--json`, to assert coverage has not regressed.",
    ],
    examples: [
      { command: "warden coverage", description: "The human matrix, grouped by manager." },
      {
        command: "warden coverage --json",
        description: "The machine-readable matrix plus the documented unsupported paths.",
      },
    ],
    behaviour:
      "Every row comes from the same command grammar the shim consults at runtime, so the matrix cannot drift from behaviour. Install, frozen install, exec, and rebuild are mediated; anything outside the grammar passes straight through.",
    gotchas: [
      "PATH shims are not an operating-system sandbox. An absolute path, a container, or Corepack can bypass them, and each is listed explicitly rather than quietly claimed.",
      "Interception can be turned off per scope with `warden config intercept`, which the matrix does not reflect.",
    ],
  },

  integrations: {
    intro:
      "Answers whether Warden is actually in the path of your installs, rather than merely present on disk. Every claim a security tool makes is worthless if the shim is behind the real binary on PATH, so this verb checks the wiring and tells you how to repair each part of it.",
    whenToUse: [
      "Straight after installing, to confirm the shims are in front of your package managers.",
      "When a command you expected Warden to vet went through untouched.",
      "In a setup script or a machine image build, with `--json`, to fail the build on a broken install.",
    ],
    examples: [
      {
        command: "warden integrations doctor",
        description:
          "The full report: shims, PATH precedence, per-tool interception, agent adapter, project manager, and CI workflow.",
      },
      {
        command: "warden integrations doctor --json",
        description:
          "The machine-readable report, including how many command forms are mediated and how many documented paths are not.",
      },
    ],
    behaviour:
      "Each check reports ok, warn, info, or fail, and every non-ok check carries the command that fixes it. Only a fail is fatal: the verb exits `30` when something is actively broken, such as the shim directory being absent from PATH, and `0` otherwise. Tools that are merely not shimmed are reported as information rather than treated as failures.",
    gotchas: [
      "PATH precedence is read from the current process, so a shell that has not been restarted since installation reports the state of that shell rather than of a fresh one.",
      "A healthy report means the wiring is correct, not that every command form is covered. Run `warden coverage` for the boundary of what the shim mediates at all.",
    ],
  },

  ci: {
    intro:
      "One command for a pull request. `warden ci` resolves the merge base, looks at what actually changed, and gates on it. It is the only verb designed to be the single required check in a workflow.",
    whenToUse: [
      "As a required status check on every pull request.",
      "Locally before pushing, to see what CI will say.",
      "As the machine-readable half of an agent loop, with `--reporter agent`.",
    ],
    examples: [
      {
        command: "warden ci --reporter github --base origin/main",
        description:
          "The workflow form. Emits GitHub annotations on the exact file and line, so findings appear inline in the diff.",
      },
      {
        command: "warden ci --reporter agent",
        description:
          "One JSON object carrying findings, intent, verdict, and exit code. This is what `warden handoff` consumes.",
      },
      {
        command: 'warden ci --intent-prompt "add retry with backoff to the api client"',
        description:
          "Also verify that the diff does what the prompt asked, and fail on dropped requirements or invented APIs.",
      },
    ],
    behaviour:
      "Three gates run and the worst verdict wins. Changed dependencies are vetted through the engine. A surface is audited only when it appears in the diff: a `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock` change triggers the lockfile audit, a `package.json` change triggers the scripts audit, and an `.npmrc` change triggers the config audit. Intent runs when a prompt is available and the diff touches JavaScript or TypeScript. Every run writes `.warden/last-run.json` for the handoff.",
    gotchas: [
      "The merge base must exist. In GitHub Actions check out with `fetch-depth: 0`.",
      "Surfaces untouched by the diff are not scanned, which keeps the gate scoped to the pull request rather than to the whole repository's history.",
      "`warden.config.json` can set `ci.failOn` to `warn` to make warnings blocking.",
    ],
  },

  doctor: {
    intro:
      "The repair loop, and the reason Warden exists as more than a scanner. Doctor audits what you already depend on, then refuses to trust its own fix: every candidate upgrade goes through the same supply-chain engine as `warden check` before it is offered to you.",
    whenToUse: [
      "When `npm audit` reports vulnerabilities and you want a fix that has itself been vetted.",
      "After inheriting a project, to see what is already broken.",
      "In an agent loop, with `--json --no-apply`, to plan before writing anything.",
    ],
    examples: [
      {
        command: "warden doctor --no-apply",
        description: "Audit and plan without touching `package.json`. Start here.",
      },
      {
        command: "warden doctor",
        description:
          "Apply the first plan that passes verification, then reinstall. The manifest is restored if that install fails.",
      },
      {
        command: "warden doctor --json --no-apply",
        description: "The agent form. The shape is published by `warden schema doctor`.",
      },
      {
        command: "warden doctor --dir ./packages/api --no-verify",
        description:
          "Audit one workspace package and skip isolated verification when you only want the plan.",
      },
    ],
    behaviour:
      "Audit against OSV, the known-malware blocklist, and deprecation metadata. Gate every candidate fix through `checkPackage`. Build a minimal plan and a latest plan. Verify each in a throwaway copy of the project with lifecycle scripts disabled, running your own `test`, `typecheck`, and `build` scripts in that order. Apply the first plan that passes. If the officially advised fixed version fails the gate, the dependency is reported UNFIXABLE instead of being upgraded into a compromised release.",
    gotchas: [
      "Applying writes an exact version, not a range, because the exact version is what was gated and verified.",
      "Exit `30` on a seemingly clean project means the audit could not complete. Read `notes`, and the `audited` and `skipped` counts.",
      "A failed advisory lookup treats vulnerabilities as unknown, never as absent.",
      "`wnpm doctor` is the same core with the same flags, report, and exit codes.",
    ],
  },

  intent: {
    intro:
      "A package check asks whether a dependency is safe. Intent asks a different question: did this diff do what the prompt asked? It is aimed at code an agent wrote, where the failure mode is not malice but quiet drift.",
    whenToUse: [
      "Gating on added imports of packages that are undeclared, or that do not exist on the registry at all.",
      "Reviewing an agent's pull request, before reading the diff line by line.",
      "When you suspect a call to an API that does not exist, in a repo that has no type check.",
      "Not as a blocking gate on claim matching: its measured precision does not meet the stated false-positive budget.",
    ],
    examples: [
      {
        command: 'warden intent check --prompt "add rate limiting to the api client"',
        description: "The full pass: claims, matching, scope creep, and hallucinated APIs.",
      },
      {
        command: "warden intent symbols",
        description:
          "Only the deterministic hallucinated-API scan. Needs no model and never executes a package.",
      },
      {
        command: "warden intent diff",
        description:
          "Show how the diff was parsed and classified into hunks, for debugging a bad match.",
      },
      {
        command: "warden intent bench",
        description:
          "Run the evaluation corpus offline and print precision and recall for each rule separately.",
      },
    ],
    behaviour:
      "Claims are extracted from the prompt, matched against classified diff hunks, and reported as delivered, partial, or dropped. Unmatched hunks become scope creep. Symbols are checked against a curated API surface database and against the packages actually installed in `node_modules`, by reading exports statically. Every bare import on an added line is checked against `package.json`, the slopsquat intel list, and, for names that are neither declared nor installed, the registry.",
    gotchas: [
      "Claim extraction can use a model, including zero-key providers via the Claude or Codex CLI. When none is available the deterministic passes still run, the report is still published with `claims_status: \"unverifiable\"`, and the exit code is 20 if a deterministic rule found something or 10 if it did not.",
      "`--offline` skips the registry lookup. The report then records that the existence check was skipped rather than reporting clean.",
      "There is no waiver mechanism. A verdict you disagree with can only be silenced by removing the prompt, which turns the whole check off.",
      "Matching is heuristic. A prompt narrowed to the change actually being made produces far better results than a paragraph of context.",
      "The prompt can come from `.warden/prompt.txt` instead of a flag, which is how the agent hooks supply it.",
    ],
  },

  detect: {
    intro:
      "Answers the question every other tool assumes you already know: what is this repository? Detect classifies the workspace topology, the package manager actually in use, the framework, the role of each package, and the tooling, with the evidence for each conclusion.",
    whenToUse: [
      "First contact with an unfamiliar monorepo.",
      "As the first step of an agent loop, so later decisions are grounded.",
      "When you are not sure which package manager a repository expects.",
    ],
    examples: [
      { command: "warden detect", description: "Human-readable classification of the workspace." },
      {
        command: "warden detect --json",
        description: "The manifest an agent should read before deciding anything else.",
      },
    ],
    behaviour:
      "Reads manifests, lockfiles, and config files. Every classification carries the evidence that produced it, so a wrong answer is debuggable rather than mysterious.",
  },

  init: {
    intro:
      "Onboards a repository in one step: writes the project config, a CI workflow, and the agent context files that teach a coding agent to call Warden before it installs anything.",
    whenToUse: [
      "Once per repository, when adopting Warden.",
      "When adding Warden to a repository that agents work in.",
    ],
    examples: [
      { command: "warden init", description: "Interactive. Shows each file before writing it." },
      {
        command: "warden init --yes",
        description: "Accept every offered change, for scripted setup.",
      },
    ],
    behaviour:
      "Nothing is overwritten without being shown first. The generated workflow uses `warden ci`, and the agent context files describe the pre-install check and the doctor repair loop.",
  },

  handoff: {
    intro:
      "The handoff. `warden handoff` reads the last CI run and produces a bundle a coding agent can act on, with adapters for the agent you actually use.",
    whenToUse: [
      "After `warden ci` fails and you want an agent to resolve it.",
      "As the last step of the agent loop, feeding the finding back with its verify command.",
    ],
    examples: [
      {
        command: "warden handoff",
        description: "Print the handoff bundle for the last failing run.",
      },
    ],
    behaviour:
      "Reads `.warden/last-run.json`. Every finding carries both a `fix` and a `verify` field, so the agent is told the command that proves the fix worked rather than being left to guess. Adapters exist for Claude, Cursor, Codex, Copilot, Gemini, Aider, and OpenCode.",
    gotchas: [
      "Run `warden ci` first. Without `.warden/last-run.json` there is nothing to hand off.",
    ],
  },

  config: {
    intro:
      "Reads and writes user-level settings: how loud Warden is, and whether the shims intercept your package managers.",
    whenToUse: [
      "To turn interception off temporarily without uninstalling.",
      "To check what Warden currently believes your settings are.",
    ],
    examples: [
      { command: "warden config", description: "Print the current settings." },
      {
        command: "warden config mode brief",
        description: "Set output verbosity for intercepted installs.",
      },
      { command: "warden config intercept off", description: "Stop the shims vetting installs." },
      {
        command: "warden config agent codex",
        description:
          "Choose which coding agent `warden handoff` hands off to. One of claude, cursor, codex, copilot, gemini, aider, or opencode.",
      },
    ],
    behaviour:
      "Settings live in `~/.warden/config.json`. Project policy is separate and lives in `warden.config.json`.",
  },

  uninstall: {
    intro:
      "Removes everything Warden installed: the binaries, the shims that sit in front of your package managers, the config, the cache, and the lines added to your shell rc.",
    whenToUse: ["When removing Warden, or before a clean reinstall."],
    examples: [{ command: "warden uninstall", description: "Remove Warden completely." }],
    behaviour: "The shell rc lines Warden added are removed; lines it did not add are left alone.",
  },

  log: {
    intro:
      "Every verdict Warden reaches is appended to `~/.warden/log.jsonl`. This verb renders that history.",
    whenToUse: [
      "To see what was blocked recently and why.",
      "To confirm interception is actually running.",
    ],
    examples: [
      { command: "warden log --tail 20", description: "The last twenty verdicts." },
      { command: "warden log --json", description: "Raw JSON lines, for piping into other tools." },
    ],
  },

  schema: {
    intro:
      "Warden's structured output is a contract, and this verb publishes it. An agent should read the schema rather than pattern-matching on human text.",
    whenToUse: [
      "When writing an integration that parses Warden's JSON.",
      "To discover what structured reports exist at all.",
    ],
    examples: [
      { command: "warden schema list", description: "Names every published report type." },
      { command: "warden schema doctor", description: "The full JSON Schema for a doctor report." },
      { command: "warden schema audit", description: "The report shape for the check surfaces." },
    ],
    behaviour:
      "Every report carries `schema_version`. The verdict fields and the four exit codes are stable contracts and will not change without a version bump and migration notes.",
  },

  completions: {
    intro:
      "Prints a shell completion script generated from the same command registry that produces the help text, so completions cannot drift from the CLI.",
    whenToUse: ["Once, during setup. The installer offers to do this for you."],
    examples: [
      { command: "warden completions zsh > ~/.zsh/completions/_warden", description: "zsh." },
      { command: "warden completions bash > /etc/bash_completion.d/warden", description: "bash." },
      {
        command: "warden completions fish > ~/.config/fish/completions/warden.fish",
        description: "fish.",
      },
    ],
    behaviour:
      "Covers verbs, flags, and finite flag values such as reporters, shells, and check surfaces. Completions are emitted for `wnpm` as well as `warden`.",
  },

  version: {
    intro:
      "Prints the analyzer version. This is the same value that appears as `analyzer_version` in every verdict, so a cached verdict can be tied to the engine that produced it.",
    whenToUse: ["In bug reports, and when pinning a version in CI."],
    examples: [{ command: "warden --version", description: "Print the version." }],
  },
};
