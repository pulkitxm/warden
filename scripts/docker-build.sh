#!/bin/sh
set -eu

image="${1:-warden:dev}"
log="${TMPDIR:-/tmp}/warden-docker-build.log"
start=$(date +%s)

fail() {
  printf '\r\033[2Kdocker: building %s failed\n' "$image"
  cat "$log"
  exit 1
}

if [ ! -t 2 ]; then
  printf 'docker: building %s...\n' "$image"
  docker build --progress=plain -t "$image" . >"$log" 2>&1 || fail
  printf 'docker: built %s in %ss\n' "$image" "$(($(date +%s) - start))"
  exit 0
fi

docker build --progress=plain -t "$image" . >"$log" 2>&1 &
pid=$!

frames='-\|/'
tick=0
while kill -0 "$pid" 2>/dev/null; do
  tick=$((tick + 1))
  frame=$(printf '%s' "$frames" | cut -c$((tick % 4 + 1)))
  step=$(grep -E '^#[0-9]+ ' "$log" 2>/dev/null | tail -n 1 | cut -c1-64)
  printf '\r\033[2K%s docker build %ss  %s' "$frame" "$(($(date +%s) - start))" "$step" >&2
  sleep 0.2
done

wait "$pid" || fail
printf '\r\033[2Kdocker: built %s in %ss\n' "$image" "$(($(date +%s) - start))"
