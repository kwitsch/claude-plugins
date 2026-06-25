#!/usr/bin/env bash
# mjs-launch.sh — runtime launcher for this plugin's local .mjs program(s).
# Prefers bun; falls back to node; errors if neither is available.
# stdout MUST stay clean (stdio MCP channel); all messages → stderr.
# Non-interactive PATH often lacks ~/.local/bin and ~/.bun/bin; prepend them.
# Use ${HOME}, never ~. No empty PATH segment.
set -euo pipefail
export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin${PATH:+:${PATH}}"

if [ "$#" -eq 0 ]; then
  echo "mjs-launch.sh: missing argument (expected a .mjs script path)" >&2
  exit 64
fi

if command -v bun  >/dev/null 2>&1; then exec bun  "$@"; fi
if command -v node >/dev/null 2>&1; then exec node "$@"; fi
echo "mjs-launch.sh: neither bun nor node is available. Install Node.js or Bun." >&2
exit 1
