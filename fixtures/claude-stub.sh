#!/bin/sh
cat >/dev/null
if [ "$CLAUDE_STUB_EXIT" != "" ]; then
  echo "stub failure" >&2
  exit "$CLAUDE_STUB_EXIT"
fi
printf '%s' "$CLAUDE_STUB_OUTPUT"
