#!/bin/sh
cat >/dev/null
if [ "$CODEX_STUB_EXIT" != "" ]; then
  echo "stub failure" >&2
  exit "$CODEX_STUB_EXIT"
fi
printf '%s' "$CODEX_STUB_OUTPUT"
