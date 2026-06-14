#!/usr/bin/env bash
# bnx.sh — runtime launcher for cave-context .mjs scripts and npm packages
# (the upstream context-mode MCP server included). Prefers bun; falls back to
# node (.mjs) / npx (npm packages). Owns runtime selection so .mjs/server/package
# callers never invoke node/npx directly.
#
# Dispatch on the FIRST argument:
#   *.mjs        local script  → `bun <args>`   if bun present, else `node <args>`
#   <package>    npm package   → `bun x <args>` if bun present, else `npx -y <args>`
#
# Non-interactive PATH often lacks ~/.local/bin and ~/.bun/bin; prepend them.
# Use ${HOME}, never ~ (~ does not expand inside quotes / some non-interactive shells).
set -euo pipefail

export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin:${PATH}"

if [ "$#" -eq 0 ]; then
  echo "bnx.sh: missing argument (expected a .mjs script or an npm package name)" >&2
  exit 64
fi

first="$1"

if command -v bun >/dev/null 2>&1; then
  case "$first" in
    *.mjs) exec bun "$@" ;;
    *)     exec bun x "$@" ;;
  esac
else
  case "$first" in
    *.mjs) exec node "$@" ;;
    *)     exec npx -y "$@" ;;
  esac
fi
