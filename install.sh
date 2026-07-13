#!/bin/sh
set -eu

repo=pulkitxm/warden
root=$HOME/.warden
bin_dir=$root/bin
shim_dir=$root/shims
path_line='export PATH="$HOME/.warden/shims:$HOME/.warden/bin:$PATH"'

shell_name=${SHELL:-/bin/sh}
shell_name=${shell_name##*/}
case "$shell_name" in
  zsh)
    shell_rc=$HOME/.zshrc
    ;;
  bash)
    shell_rc=$HOME/.bashrc
    ;;
  *)
    shell_rc=$HOME/.profile
    ;;
esac

if [ "${1:-}" = "--uninstall" ]; then
  for link_dir in /usr/local/bin "$HOME/.local/bin"; do
    for binary in warden wnpm wnpx; do
      link=$link_dir/$binary
      if [ -L "$link" ] && [ "$(readlink "$link")" = "$bin_dir/$binary" ]; then
        rm -f "$link"
      fi
    done
  done
  rm -rf "$root"
  if [ -f "$shell_rc" ] && grep -F "$path_line" "$shell_rc" >/dev/null 2>&1; then
    clean_rc=$shell_rc.warden.tmp
    grep -Fv "$path_line" "$shell_rc" >"$clean_rc" || true
    mv "$clean_rc" "$shell_rc"
  fi
  printf 'removed ~/.warden (binaries, shims, cache, config)\n'
  printf 'removed PATH line from %s\n' "$shell_rc"
  printf 'package managers restored to direct execution\n'
  exit 0
fi

case $(uname -s) in
  Darwin)
    os=darwin
    ;;
  Linux)
    os=linux
    ;;
  *)
    printf 'warden installer: unsupported system\n' >&2
    exit 1
    ;;
esac

case $(uname -m) in
  x86_64|amd64)
    arch=x64
    ;;
  arm64|aarch64)
    arch=arm64
    ;;
  *)
    printf 'warden installer: unsupported architecture\n' >&2
    exit 1
    ;;
esac

printf '\nwarden installer\n\n'
printf '  system     %s %s\n' "$os" "$arch"
printf '  shell      %s (%s)\n' "$shell_name" "$shell_rc"

managers=
for manager in npm pnpm yarn bun; do
  if command -v "$manager" >/dev/null 2>&1; then
    manager_version=$($manager --version 2>/dev/null | head -n 1 || true)
    managers="$managers $manager $manager_version,"
  fi
done
[ -n "$managers" ] || managers=' none,'
printf '  managers  %s found\n' "${managers%,}"

existing=false
old_version=
if [ -x "$bin_dir/warden" ]; then
  existing=true
  old_version=$($bin_dir/warden --version 2>/dev/null || printf 'installed')
  printf '  existing   %s at ~/.warden/bin\n' "$old_version"
else
  printf '  existing   none\n'
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
source_dir=${WARDEN_INSTALL_SOURCE:-}
if [ -n "$source_dir" ]; then
  printf '\nusing local source %s\n' "$source_dir"
  for binary in warden wnpm wnpx; do
    cp "$source_dir/dist/$binary" "$tmp/$binary"
  done
  version=local
else
  asset=warden-$os-$arch.tar.gz
  latest=https://github.com/$repo/releases/latest/download/$asset
  effective=$(curl -fL "$latest" -o "$tmp/$asset" -w '%{url_effective}')
  tag=${effective#*releases/download/}
  tag=${tag%%/*}
  version=${tag#v}
  curl -fsSL "https://github.com/$repo/releases/download/$tag/sha256sums.txt" -o "$tmp/sha256sums.txt"
  awk -v file="$asset" '$2 == file || $2 == "*" file' "$tmp/sha256sums.txt" >"$tmp/expected"
  [ -s "$tmp/expected" ] || {
    printf 'warden installer: checksum missing for %s\n' "$asset" >&2
    exit 1
  }

  (
    cd "$tmp"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c expected >/dev/null
    else
      shasum -a 256 -c expected >/dev/null
    fi
  )
  printf '  sha256 verified\n'
  tar -xzf "$tmp/$asset" -C "$tmp"
fi
for binary in warden wnpm wnpx; do
  [ -x "$tmp/$binary" ] || {
    printf 'warden installer: source is missing %s\n' "$binary" >&2
    exit 1
  }
done

mkdir -p "$bin_dir"
for binary in warden wnpm wnpx; do
  cp "$tmp/$binary" "$bin_dir/$binary"
  chmod 755 "$bin_dir/$binary"
done
if [ -n "$source_dir" ]; then
  cp "$source_dir/install.sh" "$root/install.sh"
else
  curl -fsSL "https://raw.githubusercontent.com/$repo/main/install.sh" -o "$root/install.sh"
fi
chmod 755 "$root/install.sh"

if [ "$existing" = true ]; then
  printf '\nupgrading %s -> %s\n' "$old_version" "$version"
  printf '  binaries replaced; shims already present; PATH already configured\n'
  printf '  config kept (~/.warden/config.json untouched)\n\n'
  printf 'done\n'
  exit 0
fi

mkdir -p "$shim_dir"
if [ -n "$source_dir" ]; then
  cp "$source_dir/scripts/shim.sh" "$tmp/shim.sh"
else
  curl -fsSL "https://raw.githubusercontent.com/$repo/main/scripts/shim.sh" -o "$tmp/shim.sh"
fi
installed_shims=
for manager in npm pnpm yarn bun npx bunx; do
  if command -v "$manager" >/dev/null 2>&1; then
    cp "$tmp/shim.sh" "$shim_dir/$manager"
    chmod 755 "$shim_dir/$manager"
    installed_shims="$installed_shims $manager"
  fi
done

touch "$shell_rc"
if ! grep -F "$path_line" "$shell_rc" >/dev/null 2>&1; then
  printf '%s\n' "$path_line" >>"$shell_rc"
  path_status="added ~/.warden/shims and ~/.warden/bin to $shell_rc"
else
  path_status='already configured'
fi

printf '\n  installed  ~/.warden/bin/warden, wnpm, wnpx\n'
printf '  shims     %s\n' "${installed_shims:- none}"
printf '  PATH       %s\n\n' "$path_status"
printf 'When warden finds a risky package:\n'
printf '  1) protect  stop the install and show why  (recommended)\n'
printf '  2) observe  never stop anything, just keep a record\n'
printf 'choice [1]: '
read -r choice || choice=1
case "$choice" in
  2)
    mode=log
    ;;
  *)
    mode=brief
    ;;
esac

cat >"$root/config.json" <<EOF
{
  "mode": "$mode",
  "intercept": { "install": true, "exec": true }
}
EOF

link_dir=
for candidate in /usr/local/bin "$HOME/.local/bin"; do
  case ":$PATH:" in
    *":$candidate:"*) ;;
    *) continue ;;
  esac
  if [ -d "$candidate" ] && [ -w "$candidate" ]; then
    link_dir=$candidate
    break
  fi
done
if [ -n "$link_dir" ]; then
  for binary in warden wnpm wnpx; do
    ln -sf "$bin_dir/$binary" "$link_dir/$binary"
  done
fi

printf '\n  config     ~/.warden/config.json  (mode: %s, intercept: install+exec)\n\n' "$mode"
if [ -n "$link_dir" ]; then
  printf 'done; warden is ready in this shell (linked into %s)\n' "$link_dir"
  printf 'package-manager interception starts in new shells\n'
else
  printf 'done; to use warden in this shell right now, run:\n'
  printf '  export PATH="$HOME/.warden/shims:$HOME/.warden/bin:$PATH"\n'
  printf 'new shells pick it up automatically\n'
fi
printf 'verify with: warden check left-pad\n'
