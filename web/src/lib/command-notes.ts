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
          "One JSON object carrying findings, intent, verdict, and exit code. This is what `warden fix` consumes.",
      },
      {
        command: 'warden ci --intent-prompt "add retry with backoff to the api client"',
        description:
          "Also verify that the diff does what the prompt asked, and fail on dropped requirements or invented APIs.",
      },
    ],
    behaviour:
      "Three gates run and the worst verdict wins. Changed dependencies are vetted through the engine. A surface is audited only when it appears in the diff: a `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` change triggers the lockfile audit, a `package.json` change triggers the scripts audit, and an `.npmrc` change triggers the config audit. Intent runs when a prompt is available and the diff touches JavaScript or TypeScript. Every run writes `.warden/last-run.json` for the handoff.",
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
      "Reviewing an agent's pull request, before reading the diff line by line.",
      "In CI, through `warden ci --intent-prompt`, to fail on dropped requirements.",
      "When you suspect a call to an API that does not exist.",
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
        description: "Show how the diff was parsed and classified into hunks, for debugging a bad match.",
      },
    ],
    behaviour:
      "Claims are extracted from the prompt, matched against classified diff hunks, and reported as delivered, partial, or dropped. Unmatched hunks become scope creep. Symbols are checked against a curated API surface database and against the packages actually installed in `node_modules`, by reading exports statically.",
    gotchas: [
      "Claim extraction can use a model, including zero-key providers via the Claude or Codex CLI. When none is available the deterministic passes still run and the report says the extraction degraded.",
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
      { command: "warden init --yes", description: "Accept every offered change, for scripted setup." },
    ],
    behaviour:
      "Nothing is overwritten without being shown first. The generated workflow uses `warden ci`, and the agent context files describe the pre-install check and the doctor repair loop.",
  },

  fix: {
    intro:
      "The handoff. `warden fix` reads the last CI run and produces a bundle a coding agent can act on, with adapters for the agent you actually use.",
    whenToUse: [
      "After `warden ci` fails and you want an agent to resolve it.",
      "As the last step of the agent loop, feeding the finding back with its verify command.",
    ],
    examples: [
      { command: "warden fix", description: "Print the handoff bundle for the last failing run." },
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
      { command: "warden config mode brief", description: "Set output verbosity for intercepted installs." },
      { command: "warden config intercept off", description: "Stop the shims vetting installs." },
      {
        command: "warden config agent codex",
        description:
          "Choose which coding agent `warden fix` hands off to. One of claude, cursor, codex, copilot, gemini, aider, or opencode.",
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
      { command: "warden completions fish > ~/.config/fish/completions/warden.fish", description: "fish." },
    ],
    behaviour:
      "Covers verbs, flags, and finite flag values such as reporters, shells, and check surfaces. Completions are emitted for `wnpm` as well as `warden`.",
  },

  version: {
    intro:
      "Prints the analyzer version. This is the same value that appears as `analyzer_version` in every verdict, so a cached verdict can be tied to the engine that produced it.",
    whenToUse: ["In bug reports, and when pinning a version in CI."],
    examples: [
      { command: "warden --version", description: "Print the version." },
    ],
  },
};
