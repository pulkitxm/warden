<img src="web/public/logo.svg" alt="" width="72" align="left" />

# Warden

A trust layer that checks a package, or an agent's diff, before it runs. `warden check` / `wnpm install` / `wnpx` vet packages against a deterministic supply-chain engine before install or execution. `wnpm doctor` audits existing dependencies against OSV advisories and applies only a verified fix, rejecting the official patch when the patch itself is malicious. `warden intent check` reads an agent's diff against the prompt it was given and flags dropped requirements, unrequested scope, and calls to APIs that don't exist.

## Hackathon submission

**[warden.pulkit.page/hack](https://warden.pulkit.page/hack)** collects the deck, the demo video, and the four demo beats on one page.

- [Live deck](https://warden.pulkit.page/presentation/index.html)
- [Slide PDF](https://warden.pulkit.page/presentation/warden-deck.pdf)
- [Demo video](https://warden.pulkit.page/presentation/warden-preview.mp4)
- [Speaker notes](https://warden.pulkit.page/presentation/presentation-context.md)

## Try it

```sh
make install
bun run build

./dist/wnpm install left-pad
./dist/wnpm doctor
./dist/warden intent check --prompt "add rate limiting to the api client"
```

Exit codes are `0` allow, `10` warn, `20` block, `30` analysis error. `--json` writes machine-readable output to stdout on every verb that has a report, `warden schema list` names them, and `--no-color` disables ANSI.

## Docs

Full documentation lives at **[warden.pulkit.page/docs](https://warden.pulkit.page/docs)**.

- [Getting started](https://warden.pulkit.page/docs/getting-started) and [concepts](https://warden.pulkit.page/docs/concepts)
- [CLI reference](https://warden.pulkit.page/docs/cli), generated from the command registry
- [Doctor](https://warden.pulkit.page/docs/doctor), [intent](https://warden.pulkit.page/docs/intent), [CI](https://warden.pulkit.page/docs/ci), and [check surfaces](https://warden.pulkit.page/docs/check-surfaces)
- [Agents](https://warden.pulkit.page/docs/agents) and the [threat model](https://warden.pulkit.page/docs/security)

Every docs page has a markdown mirror for agents, at the same path with a `.md` suffix, and [`/llms.txt`](https://warden.pulkit.page/llms.txt) indexes them all. The in-repo [`docs/`](docs/README.md) directory holds the longer-form engineering notes, and [`demo/`](demo) runs everything without network access.
