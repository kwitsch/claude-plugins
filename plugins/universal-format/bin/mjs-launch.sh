#!/usr/bin/env bash
# mjs-launch.sh — runtime launcher for this plugin's mcp/server.mjs.
# Prefers bun; falls back to node; errors if neither is available.
# stdout MUST stay clean (stdio MCP channel); all messages -> stderr.
#
# PATH order deviates from this repo's documented bin/mjs-launch.sh template
# (.claude/rules/hooks-mcp-server.md), which prepends ~/.local/bin/~/.bun/bin
# ahead of the inherited PATH: here they are APPENDED instead (existing PATH
# wins) so a stale/older binary of the same name in those user dirs can never
# shadow a canonical system-installed tool -- a correctness finding raised
# and explicitly decided during universal-lint's rtk/PATH-hardening review
# (this wrapper mirrors that decision for consistency between the two
# sibling formatter/linter plugins).
# ${PATH:+${PATH}:} is empty when PATH is unset/empty (avoids a leading ":"
# -- an empty PATH segment resolves to cwd in PATH lookups).
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
