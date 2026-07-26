<img src="web/public/logo.svg" alt="" width="72" align="left" />

# Warden

Safe dependency changes for humans and coding agents.

A dependency change is a transaction, not a package name. `warden plan` resolves the complete prospective graph, direct and transitive, without running a line of package code, diffs it against your lockfile, vets every added or changed package, and returns one decision. `warden apply` installs with lifecycle scripts suppressed by your own package manager, runs your tests, restores the root manifest on failure, and writes a receipt. `warden ci --require-transaction-receipt` fails a pull request whose graph changed without one, which is the control that does not depend on anything having worked locally.

## Hackathon submission

**[warden.pulkit.page/hack](https://warden.pulkit.page/hack)** collects the deck, the slide PDF, and the six demo beats on one page.

- [Live deck](https://warden.pulkit.page/presentation/index.html)
- [Slide PDF](https://warden.pulkit.page/presentation/warden-deck.pdf)
- [Speaker notes](https://warden.pulkit.page/presentation/presentation-context.md)

## Try it

```sh
make install
bun run build

./dist/warden plan -- npm install left-pad
./dist/warden apply <plan-id>
./dist/warden verify

./dist/warden coverage          # which commands the shims actually mediate
./dist/warden policy            # your policy in your package manager's own settings
./dist/warden explain left-pad@1.3.0
./dist/wnpm doctor
```

Exit codes are `0` allow, `10` warn or needs approval, `20` block, `30` analysis error. `--json` writes machine-readable output to stdout on every verb that has a report, `warden schema list` names them, and `--no-color` disables ANSI.

## Docs

Full documentation lives at **[warden.pulkit.page/docs](https://warden.pulkit.page/docs)**.

- [Getting started](https://warden.pulkit.page/docs/getting-started) and [concepts](https://warden.pulkit.page/docs/concepts)
- [CLI reference](https://warden.pulkit.page/docs/cli), generated from the command registry
- [Transactions](https://warden.pulkit.page/docs/transactions): plan, approve, apply, verify
- [Policy](https://warden.pulkit.page/docs/policy) compiled into npm, pnpm, Yarn, and Bun's own controls
- [Doctor](https://warden.pulkit.page/docs/doctor), [intent](https://warden.pulkit.page/docs/intent), [CI](https://warden.pulkit.page/docs/ci), and [check surfaces](https://warden.pulkit.page/docs/check-surfaces)
- [Agents](https://warden.pulkit.page/docs/agents) and the [threat model](https://warden.pulkit.page/docs/security)
- [Command coverage](https://warden.pulkit.page/docs/coverage) and [limitations](https://warden.pulkit.page/docs/limitations), which say plainly what is not covered

Every docs page has a markdown mirror for agents, at the same path with a `.md` suffix, and [`/llms.txt`](https://warden.pulkit.page/llms.txt) indexes them all. The in-repo [`docs/`](docs/README.md) directory holds the longer-form engineering notes, and [`demo/`](demo) runs everything without network access.
