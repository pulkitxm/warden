#!/bin/sh
tool=${0##*/}
shim_dir=$HOME/.warden/shims
config=$HOME/.warden/config.json
install_enabled=true
exec_enabled=true
mode=brief

if [ -f "$config" ]; then
  install_value=$(sed -n -e 's/.*"install"[[:space:]]*:[[:space:]]*true.*/true/p' -e 's/.*"install"[[:space:]]*:[[:space:]]*false.*/false/p' "$config" | head -n 1)
  exec_value=$(sed -n -e 's/.*"exec"[[:space:]]*:[[:space:]]*true.*/true/p' -e 's/.*"exec"[[:space:]]*:[[:space:]]*false.*/false/p' "$config" | head -n 1)
  mode_value=$(sed -n -e 's/.*"mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$config" | head -n 1)
  [ -n "$install_value" ] && install_enabled=$install_value
  [ -n "$exec_value" ] && exec_enabled=$exec_value
  [ -n "$mode_value" ] && mode=$mode_value
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
  if [ "$mode" = log ]; then
    if [ -n "$result" ]; then
      mkdir -p "$HOME/.warden"
      printf '%s\n' "$result" >> "$HOME/.warden/log.jsonl"
    fi
    return 0
  fi
  if [ "$status" -ge 20 ]; then
    if [ "$status" -eq 20 ]; then
      if [ "$allow_risky" = true ]; then
        "$warden" check "$spec" --allow-risky >/dev/null
      else
        "$warden" check "$spec" >/dev/null
      fi
      printf 'warden: blocked %s; override with --allow-risky\n' "$spec" >&2
    else
      [ -n "$result" ] && printf '%s\n' "$result" >&2
    fi
    exit "$status"
  fi
  if [ "$status" -eq 10 ]; then
    if [ "$allow_risky" = true ]; then
      "$warden" check "$spec" --allow-risky >/dev/null
    else
      "$warden" check "$spec" >/dev/null
    fi
  fi
}

json_field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\\1/p" | head -n 1
}

json_list() {
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\\1/p" | head -n 1 |
    tr ',' '\n' | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' | grep -v '^$'
}

json_bool() {
  printf '%s' "$1" | grep -q "\"$2\"[[:space:]]*:[[:space:]]*true" && echo true || echo false
}

plan=$("$warden" shim-plan "$tool" "$@" 2>/dev/null)
kind=$(json_field "$plan" kind)
[ -n "$kind" ] || kind=passthrough
graph_transaction=$(json_bool "$plan" graphTransaction)

if [ "$kind" = "passthrough" ]; then
  exec "$real" "$@"
fi

mediate_install=false
mediate_exec=false
case "$kind" in
  install|frozen-install|global-install|rebuild) mediate_install=true ;;
  exec) mediate_exec=true ;;
esac

if [ "$mediate_install" = true ] && [ "$install_enabled" != true ]; then
  exec "$real" "$@"
fi
if [ "$mediate_exec" = true ] && [ "$exec_enabled" != true ]; then
  exec "$real" "$@"
fi

exotic=$(printf '%s' "$plan" | sed -n 's/.*"exotic"[[:space:]]*:[[:space:]]*\[\(.*\)\][[:space:]]*,[[:space:]]*"graphTransaction".*/\1/p')
if [ -n "$exotic" ] && [ "$exotic" != "" ]; then
  if [ "$allow_risky" != true ] && [ "$mode" != log ]; then
    printf 'warden: this command installs from a git, url, or local source, which carries no registry provenance.\n' >&2
    printf 'warden: %s\n' "$exotic" >&2
    printf 'warden: override with --allow-risky after reviewing the source.\n' >&2
    exit 20
  fi
fi

for spec in $(json_list "$plan" specs); do
  vet_one "$spec"
done

if [ "$graph_transaction" = true ] && [ "$mode" != log ]; then
  "$warden" check lockfile >/dev/null 2>&1
  lock_status=$?
  if [ "$lock_status" -ge 20 ] && [ "$allow_risky" != true ]; then
    "$warden" check lockfile >&2
    printf 'warden: lockfile audit blocked this install; override with --allow-risky\n' >&2
    exit "$lock_status"
  fi
fi

if [ "$mediate_install" = true ] && [ "$mode" != log ]; then
  txn=$("$warden" shim-transaction "$tool" "$@" 2>/dev/null)
  txn_decision=$(json_field "$txn" decision)
  txn_exit=$(printf '%s' "$txn" | sed -n 's/.*"exit"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -n 1)
  [ -n "$txn_exit" ] || txn_exit=0

  if [ "$txn_decision" = "block" ]; then
    printf 'warden: this change was blocked on the whole prospective graph, not only on %s\n' "$tool" >&2
    printf '%s\n' "$txn" | sed -n 's/.*"reasons"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' |
      tr ',' '\n' | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' | grep -v '^$' |
      while IFS= read -r reason; do printf 'warden:   %s\n' "$reason" >&2; done
    if [ "$allow_risky" != true ]; then
      printf 'warden: run warden plan -- %s %s to see the full graph, or override with --allow-risky\n' "$tool" "$*" >&2
      exit "$txn_exit"
    fi
  fi

  pending=$(printf '%s' "$txn" | sed -n 's/.*"pendingScripts"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' |
    tr ',' '\n' | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' | grep -v '^$')
  if [ -n "$pending" ] && [ "$mode" != quiet ]; then
    printf 'warden: install scripts new to this graph are suppressed and will not run:\n' >&2
    printf '%s\n' "$pending" | while IFS= read -r entry; do
      name=${entry%% *}
      hook=${entry##* }
      printf 'warden:   %s (%s)\n' "$name" "$hook" >&2
      printf 'warden:     approve with: warden approve-script %s --hook %s\n' "$name" "${hook%%,*}" >&2
    done
  fi
fi

suppress=$(json_list "$plan" suppressScripts | tr '\n' ' ')
if printf '%s' "$plan" | grep -q '"YARN_ENABLE_SCRIPTS"'; then
  YARN_ENABLE_SCRIPTS=0
  export YARN_ENABLE_SCRIPTS
fi

exec_filtered() {
  remaining=$1
  shift
  if [ "$remaining" -eq 0 ]; then
    exec "$real" "$@" $suppress
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
