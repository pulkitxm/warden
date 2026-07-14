# Distribution: install.sh, releases, Docker

How warden gets onto machines and how development stays off the host.

Part of the [product plan](system-integration.md).

## Release workflow

- On tag push, cross-compile `warden`, `wnpm`, `wnpx` with `bun build --compile --target=bun-{linux,darwin}-{x64,arm64}` and upload GitHub Release assets with sha256 checksums.
- `install.sh` lives at the repo root and always installs the latest release.

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

## Docker for local development

Host stays clean while warden is in dev:

- `Dockerfile` on `oven/bun`, copies the repo, runs `bun run build`.
- `make docker-build` and `make docker-run ARGS="check left-pad"` wrap it; the run target mounts the current project directory read-only so checks see the real `package.json`.
- CI can reuse the same image later.

```
$ make docker-run ARGS="check left-pad"
docker run --rm -v "$PWD":/work:ro warden:dev check left-pad

ALLOW  left-pad@1.3.0  risk 3/100 · npm
  verdict: established package, no risk signals
```
