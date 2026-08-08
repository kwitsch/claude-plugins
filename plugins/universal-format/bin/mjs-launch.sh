#!/usr/bin/env bash
# mjs-launch.sh — runtime launcher for this plugin's mcp/server.mjs.
# Prefers bun; falls back to node; errors if neither is available.
# stdout MUST stay clean (stdio MCP channel); all messages -> stderr.
# PATH deviates from the repo template: user dirs are APPENDED (inherited PATH wins),
# so a stale user-dir binary can't shadow a system tool -- the rtk/PATH-review finding
# for universal-lint/universal-format. ${PATH:+${PATH}:} is empty when PATH is unset
# (no empty PATH segment). ${HOME}, never ~.
set -euo pipefail
export PATH="${PATH:+${PATH}:}${HOME:-}/.local/bin:${HOME:-}/.bun/bin"

if [ "$#" -eq 0 ]; then
  echo "mjs-launch.sh: missing argument (expected a .mjs script path)" >&2
  exit 64
fi

if command -v bun  >/dev/null 2>&1; then exec bun  "$@"; fi
if command -v node >/dev/null 2>&1; then exec node "$@"; fi
echo "mjs-launch.sh: neither bun nor node is available. Install Node.js or Bun." >&2
exit 1
