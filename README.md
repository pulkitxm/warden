# WNPM

WNPM checks npm packages before they install or execute. It compares releases, verifies tarball integrity, applies deterministic supply-chain rules, and returns an allow, warn, or block verdict. `wnpm doctor` extends that trust layer into repair: it audits a project's dependencies against OSV advisories, generates upgrade plans, gates every candidate version through the same verdict engine, and verifies the surviving plans by installing and running the project's own tests in isolated workspaces.

## Use

```sh
make install
bun run build

wnpm install left-pad
wnpx some-cli@latest
wnpx some-cli@latest --json

wnpm doctor
wnpm doctor --apply
```

`wnpm install` checks every requested package and installs only after clearance. `wnpx` checks a package intended for execution; it does not execute the package itself. `wnpm doctor` finds vulnerable and deprecated dependencies, then proposes the smallest verified fix — a candidate fix that fails the supply-chain check is rejected with evidence, even when an advisory names it as the official fix.

Exit codes are `0` allow, `10` warn, `20` block, and `30` analysis error. Use `--allow-risky` to override a block deliberately.

## What it detects

- typosquats, homoglyphs, scoped impersonation, and known hallucinated names
- known malicious package versions
- newly added or changed install scripts
- provenance downgrades and maintainer changes
- credential access, environment exfiltration, raw-IP traffic, reverse shells, and destructive filesystem calls
- obfuscation combined with execution or network capabilities
- known-vulnerable and deprecated dependencies in a project (`wnpm doctor`, via OSV)

Newness and low downloads never block by themselves. Deterministic rules decide the verdict; an optional OpenAI explanation can only rewrite the summary.

## Develop

```sh
make ci
```

`make install` also activates the tracked pre-push hook, which runs the same command before every push.

CI enforces comment-free source and strict Biome formatting. Use `bun run strip-comments` and `bun run format` before committing when either gate reports changes.

See [CLI](docs/cli.md), [architecture](docs/architecture.md), [detection](docs/detection.md), [development](docs/development.md), and the [offline demo](demo/README.md).
