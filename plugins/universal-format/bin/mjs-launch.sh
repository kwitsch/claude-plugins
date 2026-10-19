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

if command -v bun > /dev/null 2>&1; then exec bun "$@"; fi
# node only: V8 compile cache for the 9 MB bundle, kept in the plugin's persistent data dir
# (Claude Code exports CLAUDE_PLUGIN_DATA to MCP servers; nothing is exported without it; a user-set
# NODE_COMPILE_CACHE wins). Node < 22.1 ignores it, an unwritable dir just disables it, and node
# writes it only on a normal exit: server.ts turns stdin EOF, SIGINT and SIGTERM (how Claude Code
# stops MCP servers off Windows) into process.exit(0). The cache is process-wide, so user modules the
# server loads (a project's prettier config and its plugins) land in it too, never pruned. Numbers: CLAUDE.md.
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] && export NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-${CLAUDE_PLUGIN_DATA}/node-compile-cache}"
if command -v node > /dev/null 2>&1; then exec node "$@"; fi
echo "mjs-launch.sh: neither bun nor node is available. Install Node.js or Bun." >&2
exit 1
