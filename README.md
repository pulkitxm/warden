# Warden

A trust layer that checks a package, or an agent's diff, before it runs. `warden check` / `wnpm install` / `wnpx` vet packages against a deterministic supply-chain engine before install or execution. `wnpm doctor` audits existing dependencies against OSV advisories and applies only a verified fix, rejecting the official patch when the patch itself is malicious. `warden intent check` reads an agent's diff against the prompt it was given and flags dropped requirements, unrequested scope, and calls to APIs that don't exist.

## Hackathon submission

- [Live deck](https://warden.pulkit.page/presentation/index.html)
- [Slide PDF](https://warden.pulkit.page/presentation/warden-deck.pdf)
- [Demo video](https://warden.pulkit.page/presentation/warden-preview.mp4)
- [Presentation narrative and speaker notes](https://warden.pulkit.page/presentation/presentation-context.md)

## Try it

```sh
make install
bun run build

./dist/wnpm install left-pad
./dist/wnpm doctor
./dist/warden intent check --prompt "add rate limiting to the api client"
```

Exit codes are `0` allow, `10` warn, `20` block, `30` analysis error.

## Docs

[Features](https://warden.pulkit.page/docs/features.md) is the full inventory; [functionality](https://warden.pulkit.page/docs/functionality.md) walks through real captured output for every command. [Doctor](https://warden.pulkit.page/docs/doctor.md) and [intent](https://warden.pulkit.page/docs/intent.md) cover those two features in depth. [Offline demo](https://warden.pulkit.page/demo/README.md) runs everything without network access.
