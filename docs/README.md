# Engineering docs

User documentation lives on the website at **[warden.pulkit.page/docs](https://warden.pulkit.page/docs)**, which is generated from the command registry and cannot drift from the binary. This directory holds the longer-form engineering notes behind it.

| Doc | Covers | Status |
| --- | --- | --- |
| [features](features.md) | Inventory of what ships | Shipped |
| [functionality](functionality.md) | Captured output for every command | Shipped |
| [doctor](doctor.md) | The audit, gate, verify, apply loop | Shipped |
| [intent](intent.md) | Prompt-as-spec verification | Shipped |
| [check-surfaces](check-surfaces.md) | Lockfile, install script, and registry config audits | Shipped |
| [transactions](transactions.md) | Prospective graph resolution and the plan decision | Shipped |
| [explainability](explainability.md) | explain, history, compare, and the standing script surface | Shipped |
| [agent-first-cli](agent-first-cli.md) | CLI conventions for agents | Shipped |
| [agent-integration](agent-integration.md) | Capability-based adapters, setup, and the generated MCP surface | Shipped |
| [interception](interception.md) | PATH shims and the intercept switch | Shipped |
| [detection-and-init](detection-and-init.md) | `warden detect` and `warden init` | Shipped |
| [config](config.md) | Config cascade and cache semantics | Shipped |
| [autocomplete](autocomplete.md) | Registry-driven completions | Shipped |
| [distribution](distribution.md) | Releases, installer, Docker | Shipped |
| [benchmark](benchmark.md) | The published corpus, and how detection and false positives are measured | Shipped |
| [test-coverage-plan](test-coverage-plan.md) | What each test layer must prove | Process |
| [system-integration](system-integration.md) | Product plan | **Plan, partly unimplemented** |

Research lives in [`research/`](../research): [citations](../research/citations.md) is the verified threat record, and [market-gaps](../research/market-gaps.md) maps those threats to commands and records what was deliberately not built.

## Repository layout

```text
src/
  bin/        warden, wnpm, wnpx entrypoints
  cli/        argument parsing, rendering, and command wiring
    commands/ one module per warden verb
    help.ts   help and completion rendering, driven by the registry
    registry.ts  COMMAND_REGISTRY, the single source of verbs
  shared/     deps interfaces, error envelopes, git helpers, ansi, arg parsing
  engine.ts   the checkPackage pipeline
  doctor/     OSV audit, plan, supply-chain gate, isolated verify, apply
  intent/     prompt-as-spec verification for agent diffs
  heuristics/ AST capability scan
  distance/   typosquat scoring against package popularity
  intel/      curated blocklist and hallucinated-name data
  audit/      lockfile, install script, and registry config surface audits
web/          Next.js documentation and marketing site
```

Dependencies point one way: `bin` to `cli` to `shared` and the domain modules. Domain modules never import from `cli`, and `test/cli/layering.test.ts` fails the build if that reverses.

The site in `web/` is a Next.js app documenting the shipped CLI. Its CLI reference is generated from the command registry by `bun scripts/export-cli-reference.ts`, so it cannot drift from the binary. See [web/README.md](../web/README.md).
