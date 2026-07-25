# Engineering docs

User documentation lives on the website at **[warden.pulkit.page/docs](https://warden.pulkit.page/docs)**, which is generated from the command registry and cannot drift from the binary. This directory holds the longer-form engineering notes behind it.

| Doc | Covers | Status |
| --- | --- | --- |
| [features](features.md) | Inventory of what ships | Shipped |
| [functionality](functionality.md) | Captured output for every command | Shipped |
| [doctor](doctor.md) | The audit, gate, verify, apply loop | Shipped |
| [intent](intent.md) | Prompt-as-spec verification | Shipped |
| [check-surfaces](check-surfaces.md) | Lockfile, install script, and registry config audits | Shipped |
| [agent-first-cli](agent-first-cli.md) | CLI conventions for agents | Shipped |
| [interception](interception.md) | PATH shims and the intercept switch | Shipped |
| [detection-and-init](detection-and-init.md) | `warden detect` and `warden init` | Shipped |
| [config](config.md) | Config cascade and cache semantics | Shipped |
| [autocomplete](autocomplete.md) | Registry-driven completions | Shipped |
| [distribution](distribution.md) | Releases, installer, Docker | Shipped |
| [test-coverage-plan](test-coverage-plan.md) | What each test layer must prove | Process |
| [system-integration](system-integration.md) | Product plan | **Plan, partly unimplemented** |

Research lives in [`research/`](../research): [citations](../research/citations.md) is the verified threat record, and [market-gaps](../research/market-gaps.md) maps those threats to commands and records what was deliberately not built.
