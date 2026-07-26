#!/bin/sh
set -eu

image="${1:-warden:dev}"
runtime="${2:-docker}"
log=$(mktemp "${TMPDIR:-/tmp}/warden-build.XXXXXX")
start=$(date +%s)
trap 'rm -f "$log"' EXIT

fail() {
  printf '\r\033[2K%s: building %s failed\n' "$runtime" "$image"
  cat "$log"
  exit 1
}

if [ ! -t 2 ]; then
  printf '%s: building %s...\n' "$runtime" "$image"
  "$runtime" build --progress=plain -t "$image" . >"$log" 2>&1 || fail
  printf '%s: built %s in %ss\n' "$runtime" "$image" "$(($(date +%s) - start))"
  exit 0
fi

"$runtime" build --progress=plain -t "$image" . >"$log" 2>&1 &
pid=$!

frames='-\|/'
tick=0
while kill -0 "$pid" 2>/dev/null; do
  tick=$((tick + 1))
  frame=$(printf '%s' "$frames" | cut -c$((tick % 4 + 1)))
  step=$(grep -aE '^#[0-9]+ ' "$log" 2>/dev/null | tail -n 1 | cut -c1-64)
  printf '\r\033[2K%s %s build %ss  %s' "$frame" "$runtime" "$(($(date +%s) - start))" "$step" >&2
  sleep 0.2
done

wait "$pid" || fail
printf '\r\033[2K%s: built %s in %ss\n' "$runtime" "$image" "$(($(date +%s) - start))"
