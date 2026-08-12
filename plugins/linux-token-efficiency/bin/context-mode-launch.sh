#!/usr/bin/env bash
# context-mode-launch.sh -- runtime launcher for the EXTERNAL `context-mode` npm package
# (upstream: https://github.com/mksglu/context-mode), registered as this plugin's
# `context-mode` MCP stdio server. Prefers bun (bunx); falls back to npx; errors if neither
# is available. Unlike bin/mjs-launch.sh in coding-toolbox/universal-format/claude-code-knowledge,
# there is no local .mjs to exec -- the target is a published package spec, so there is no
# mandatory argv and no missing-argument guard.
# stdout MUST stay clean (stdio MCP channel); all messages -> stderr.
#
# PATH order matches the sibling wrappers' hardened form: ~/.local/bin and ~/.bun/bin are
# APPENDED (inherited PATH wins), so a stale user-dir binary can never shadow a canonical
# system tool. ${PATH:+${PATH}:} keeps the expansion empty when PATH is unset/empty -- an
# empty PATH segment resolves to cwd in PATH lookups.
set -euo pipefail
export PATH="${PATH:+${PATH}:}${HOME:-}/.local/bin:${HOME:-}/.bun/bin"

# Package spec, pinned. bumped by hand with the plugin version (see CLAUDE.md).
CONTEXT_MODE_SPEC="context-mode@1.0.169"

# Fail-open toggle (.claude/rules/plugin-userconfig.md): only the literal string `false`
# disables. Exit 0, never non-zero -- /mcp then shows the server as simply not connected,
# the same contract mcp/server.mjs gives cbm_enabled=false.
if [ "${CLAUDE_PLUGIN_OPTION_CONTEXT_MODE_ENABLED:-}" = "false" ]; then
  echo "context-mode-launch.sh: disabled by the context_mode_enabled plugin option" >&2
  exit 0
fi

# Probe the package RUNNERS, not the runtimes: checking only for the node executable would be
# the wrong fallback check here, because node alone does not run npx.
if command -v bunx > /dev/null 2>&1; then exec bunx "$CONTEXT_MODE_SPEC" "$@"; fi
if command -v npx > /dev/null 2>&1; then exec npx --yes "$CONTEXT_MODE_SPEC" "$@"; fi
echo "context-mode-launch.sh: neither bunx nor npx is available. Install Node.js or Bun." >&2
exit 1
