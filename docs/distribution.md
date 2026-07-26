# Distribution: install.sh, releases, Docker

How warden gets onto machines and how development stays off the host.

Part of the [product plan](system-integration.md).

## Release workflow

- On tag push, cross-compile `warden`, `wnpm`, `wnpx` with `bun build --compile --target=bun-{linux,darwin}-{x64,arm64}` and upload GitHub Release assets with sha256 checksums.
- `install.sh` lives at `web/public/install.sh`, so the website serves it directly at `/install.sh`, and always installs the latest release.

## install.sh

Same model as Bun's installer: detect the system, download the matching prebuilt binary, wire up shims and PATH, ask the two setup questions (reporting mode, coding agent). No runtime required on the user's machine.

Usage: `curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh`

Fresh install:

```
$ curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh

warden installer

  system     darwin arm64 (Apple Silicon)
  shell      zsh (~/.zshrc)
  managers   npm 10.9.2, pnpm 9.4.0, bun 1.2.8 found; yarn not found
  existing   none

downloading warden 0.3.0 (darwin-arm64)
  https://github.com/pulkitxm/warden/releases/download/v0.3.0/warden-darwin-arm64.tar.gz
  ######################################################################## 100% 24.1 MB
  sha256 verified

Which detected package managers should warden intercept?
> [x] npm
  [x] pnpm
  [x] bun
  [x] npx
  [x] bunx
Up/down move, space toggles, enter confirms

  installed  ~/.warden/bin/warden, wnpm, wnpx
  shims      ~/.warden/shims/{npm,pnpm,bun,npx,bunx}  (yarn skipped, not installed)
  PATH       added ~/.warden/shims and ~/.warden/bin to ~/.zshrc

When warden finds a risky package:
  1) protect  stop the install and show why  (recommended)
  2) observe  never stop anything, just keep a record
choice [1]: 1

Which coding agent do you use? (for "fix with agent" handoffs)
  1) Claude Code        5) Gemini CLI
  2) Cursor CLI         6) aider
  3) Codex CLI          7) opencode
  4) Copilot CLI        8) none / ask every time
choice [1]: 1

  config     ~/.warden/config.json  (mode: brief, managers: npm+pnpm+bun+npx+bunx, intercept: install+exec, agent: claude)

done in 4.2s; warden is ready in this shell (linked into /usr/local/bin)
package-manager interception starts in new shells
verify with: warden check left-pad
```

Re-run on a machine that already has warden (upgrade path):

```
$ curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh

warden installer

  system     linux x64 (glibc)
  existing   warden 0.2.1 at ~/.warden/bin

upgrading 0.2.1 -> 0.3.0
  sha256 verified
  binaries replaced; shims already present; PATH already configured
  config kept (~/.warden/config.json untouched)

done in 2.8s
```

Uninstall:

```
$ warden uninstall
removed ~/.warden (binaries, shims, cache, config)
removed PATH line from ~/.zshrc
package managers restored to direct execution
```

The command also removes Warden-owned links from `/usr/local/bin` or `~/.local/bin`. Open a new shell after uninstalling so the updated PATH takes effect.

Notes the transcripts encode:

- The fresh-install picker starts with every detected manager selected. Shims are only written for selected commands that are present, so a shim never shadows a missing command.
- Upgrades never touch config or shims; the installer is idempotent.
- Binaries are symlinked into /usr/local/bin (or ~/.local/bin) when that directory is writable and already on PATH, so `warden` works in the current shell with no restart; the rc line exists for the shims, which need PATH precedence over the real package managers and therefore only activate in new shells.
- Every download is checksum-verified before anything is placed on PATH.

## Containers for local development

Host stays clean while warden is in dev:

- `Dockerfile` on `oven/bun`, copies the repo, runs `bun run build`. It also installs `git`, `nodejs`, `npm`, and `pnpm@9` so the shims have real package managers to intercept, and creates `/play` as a scratch project.
- `scripts/docker-build.sh <image> [runtime]` is the shared build wrapper. It takes the runtime as its second argument, so the same script drives both engines, renders a spinner on a TTY and plain progress without one, and prints the captured build log only on failure.
- The run targets mount the current project directory at `/work`, so checks see the real `package.json` and installs can write to it.

Six targets, three per runtime:

| Target | Runtime | What it does |
| --- | --- | --- |
| `make docker-build` | Docker | builds `warden:dev` |
| `make docker-run` | Docker | interactive shell with shims and completions installed |
| `make docker-run ARGS="check left-pad"` | Docker | one command through the image entrypoint, no shell |
| `make adocker-build` | Apple `container` | the same build |
| `make adocker-run` | Apple `container` | the same shell |
| `make adocker-install-demo` / `make docker-install-demo` | either | a fresh container with `PATH` reset, to demo `install.sh` from nothing |

```
$ make docker-run ARGS="check left-pad"
docker run --rm -v "$PWD":/work warden:dev check left-pad

ALLOW  left-pad@1.3.0  risk 3/100 · npm
  verdict: established package, no risk signals
```

### The Apple container targets

The `adocker-*` targets are the same recipes against [`apple/container`](https://github.com/apple/container), which runs each Linux container in its own lightweight VM on macOS instead of a shared daemon. Only the runtime binary changes: every flag the recipes use — `build -t`, `--progress=plain`, `run --rm`, `-it`, `--entrypoint`, `-e`, `-v` — is in that CLI's option set, and its Swift ArgumentParser expands a combined `-it` into `-i -t`, so the interactive path needs no rewriting.

Three prerequisites that differ from Docker, and are the reason these targets fail on a machine that has the CLI installed but not ready:

- **macOS on Apple silicon only.** There is no Linux or Intel build.
- **`container system start` must have been run.** There is no background daemon to fall back on; the build fails immediately if the service is not up.
- **Images are `arm64` Linux.** `oven/bun:1` publishes an `arm64` manifest, so the `Dockerfile` needs no change, but a base image that is `amd64`-only will not build without Rosetta.

`docker-*` and `adocker-*` produce the same `warden:dev` tag. They are not interchangeable in one session: each runtime keeps its own image store, so building with one does not populate the other.

## Release trust chain

Everything the installer executes comes from one immutable release tag, and everything is checksum-verified before it is used.

1. The installer requests `releases/latest/download/<asset>` and reads the tag out of the URL it was actually redirected to. If no tag can be resolved, it stops rather than guessing.
2. `sha256sums.txt` is fetched from that exact tag.
3. The platform tarball is verified against it before extraction.
4. `install.sh` and `shim.sh` are fetched from that same tag and verified against the same sums file before either is written to disk.

The release workflow stages both support files next to the binaries and includes them in `sha256sums.txt`, so what the installer verifies is what the release published.

Nothing is fetched from a mutable branch. Earlier versions pulled `install.sh` and `scripts/shim.sh` from `main` over raw.githubusercontent.com, unverified, which meant a push to `main` between a release and an install changed executable content on the user's machine. Two tests now enforce the rule: one greps the installer for any reference to a mutable ref, and the shell harness fails the install outright if the stub is ever asked for one.

Three failure modes are covered by tests:

- a tampered `install.sh` whose digest does not match the release fails the install and says so
- a release that does not list the support files at all is refused rather than falling back
- a missing or mismatched tarball checksum fails as it always did
