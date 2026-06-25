#!/usr/bin/env bash
# bnx.sh — node-only launcher for cave-context's local .mjs programs (server + command hooks).
# cave-context vendors context-mode and imports it in-process / spawns the vendored hook
# script directly, so there is no npm-package launch and no second runtime — node only, per the
# plugin's explicit node-only runtime choice (see CLAUDE.md). All messages → stderr.
# Non-interactive PATH often lacks ~/.local/bin; prepend it. Use ${HOME}, never ~.
set -euo pipefail
export PATH="${HOME:-}/.local/bin${PATH:+:${PATH}}"

if [ "$#" -eq 0 ]; then
  echo "bnx.sh: missing argument (expected a .mjs script path)" >&2
  exit 64
fi

if command -v node >/dev/null 2>&1; then exec node "$@"; fi
echo "bnx.sh: node is not available. Install Node.js >= 22.5." >&2
exit 1
