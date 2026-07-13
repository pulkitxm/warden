# Shell autocomplete

Warden generates shell completion scripts from the CLI registry.

Part of the [product plan](system-integration.md).

## Single source of truth

`COMMAND_REGISTRY` in `src/cli/main.ts` defines every verb, one-line description, flag, flag value hint, and positional kind. Top-level help, per-verb help, and all completion scripts read that export.

To add a verb or flag, change only `COMMAND_REGISTRY`. Help and bash, zsh, and fish completions update automatically.

## Manual setup

Add the line for your shell to its startup file:

```sh
eval "$(warden completions bash)"
```

```sh
eval "$(warden completions zsh)"
```

```fish
warden completions fish | source
```

## Installer setup

`install.sh` adds the matching eval line beside Warden's PATH line in `.bashrc` or `.zshrc`. Re-running the installer does not duplicate either line. Other shells receive only the PATH setup, and uninstall removes every line Warden added.
