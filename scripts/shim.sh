#!/bin/sh
tool=${0##*/}
shim_dir=$HOME/.warden/shims
config=$HOME/.warden/config.json
install_enabled=true
exec_enabled=true

if [ -f "$config" ]; then
  install_value=$(sed -n -e 's/.*"install"[[:space:]]*:[[:space:]]*true.*/true/p' -e 's/.*"install"[[:space:]]*:[[:space:]]*false.*/false/p' "$config" | head -n 1)
  exec_value=$(sed -n -e 's/.*"exec"[[:space:]]*:[[:space:]]*true.*/true/p' -e 's/.*"exec"[[:space:]]*:[[:space:]]*false.*/false/p' "$config" | head -n 1)
  [ -n "$install_value" ] && install_enabled=$install_value
  [ -n "$exec_value" ] && exec_enabled=$exec_value
fi

real_path=
old_ifs=$IFS
IFS=:
for path_part in $PATH; do
  [ "$path_part" = "$shim_dir" ] && continue
  if [ -z "$real_path" ]; then
    real_path=$path_part
  else
    real_path=$real_path:$path_part
  fi
done
IFS=$old_ifs
PATH=$real_path
export PATH
real=$(command -v "$tool") || {
  printf 'warden: real %s executable not found\n' "$tool" >&2
  exit 127
}

allow_risky=false
for arg in "$@"; do
  [ "$arg" = "--allow-risky" ] && allow_risky=true
done

warden=$HOME/.warden/bin/warden
[ -x "$warden" ] || warden=$(command -v warden) || {
  printf 'warden: executable not found\n' >&2
  exit 127
}

vet_one() {
  spec=$1
  if [ "$allow_risky" = true ]; then
    result=$("$warden" check "$spec" --json --allow-risky)
  else
    result=$("$warden" check "$spec" --json)
  fi
  status=$?
  if [ "$status" -ge 20 ]; then
    [ -n "$result" ] && printf '%s\n' "$result" >&2
    exit "$status"
  fi
  if [ "$status" -eq 10 ]; then
    [ -n "$result" ] && printf '%s\n' "$result" >&2
  fi
}

vet_install() {
  shift
  skip_next=false
  for arg in "$@"; do
    if [ "$skip_next" = true ]; then
      skip_next=false
      continue
    fi
    case "$arg" in
      --workspace|-w|--filter|--registry|--tag|--cache|--prefix|--cwd)
        skip_next=true
        ;;
      -*|./*|../*|/*|file:*|git:*|http:*|https:*)
        ;;
      *)
        vet_one "$arg"
        ;;
    esac
  done
}

vet_exec() {
  package_next=false
  for arg in "$@"; do
    if [ "$package_next" = true ]; then
      vet_one "$arg"
      return
    fi
    case "$arg" in
      -p|--package)
        package_next=true
        ;;
      -*)
        ;;
      *)
        vet_one "$arg"
        return
        ;;
    esac
  done
}

vet_pnpm_exec() {
  shift
  vet_exec "$@"
}

kind=none
case "$tool:$1" in
  npx:*|bunx:*)
    kind=exec
    ;;
  pnpm:dlx)
    kind=exec
    ;;
  npm:install|npm:i|npm:add|npm:update|pnpm:install|pnpm:i|pnpm:add|pnpm:update|yarn:install|yarn:i|yarn:add|yarn:update|bun:install|bun:i|bun:add|bun:update)
    kind=install
    ;;
esac

if [ "$kind" = install ] && [ "$install_enabled" = true ]; then
  vet_install "$@"
fi
if [ "$kind" = exec ] && [ "$exec_enabled" = true ]; then
  if [ "$tool" = pnpm ]; then
    vet_pnpm_exec "$@"
  else
    vet_exec "$@"
  fi
fi

exec_filtered() {
  remaining=$1
  shift
  if [ "$remaining" -eq 0 ]; then
    exec "$real" "$@"
  fi
  first=$1
  shift
  remaining=$((remaining - 1))
  if [ "$first" = "--allow-risky" ]; then
    exec_filtered "$remaining" "$@"
  else
    exec_filtered "$remaining" "$@" "$first"
  fi
}

exec_filtered "$#" "$@"
