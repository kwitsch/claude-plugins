#!/usr/bin/env bash
# bnx.sh — runtime launcher for cave-context .mjs scripts and npm packages
# (the upstream context-mode CLI/MCP server included). Owns runtime selection so
# callers never invoke node/npx/bun directly. Dispatch on the FIRST argument:
#   *.mjs     local script → `bun <args>`  if bun present, else `node <args>`
#   <package> npm package  → `bun add -g <pkg>` then exec from `bun pm bin -g`;
#             else `npx -y <pkg> …`; else error.
# `bun x` is intentionally NOT used for packages — it is unreliable for some npm
# packages here; `bun add -g` + exec from the global bin dir is deterministic.
# Non-interactive PATH often lacks ~/.local/bin and ~/.bun/bin; prepend them.
# Use ${HOME}, never ~. No empty PATH segment. All messages → stderr.
set -euo pipefail
export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin${PATH:+:${PATH}}"

if [ "$#" -eq 0 ]; then
  echo "bnx.sh: missing argument (expected a .mjs script or an npm package name)" >&2
  exit 64
fi

first="$1"

case "$first" in
  *.mjs)
    if command -v bun  >/dev/null 2>&1; then exec bun  "$@"; fi
    if command -v node >/dev/null 2>&1; then exec node "$@"; fi
    echo "bnx.sh: neither bun nor node is available to run $first" >&2
    exit 1
    ;;
  *)
    pkg="$1"; shift
    if command -v bun >/dev/null 2>&1; then
      BUN_BIN="$(bun pm bin -g 2>/dev/null || true)"
      if [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN/$pkg" ]; then exec "$BUN_BIN/$pkg" "$@"; fi   # warm/offline path — already installed
      bun add -g "$pkg" >&2 || echo "bnx.sh: 'bun add -g $pkg' failed; will try npx" >&2
      BUN_BIN="$(bun pm bin -g 2>/dev/null || true)"
      if [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN/$pkg" ]; then exec "$BUN_BIN/$pkg" "$@"; fi
      command -v "$pkg" >/dev/null 2>&1 && exec "$pkg" "$@"
      echo "bnx.sh: bun could not provide $pkg; falling back to npx..." >&2
    fi
    command -v npx >/dev/null 2>&1 && exec npx -y "$pkg" "$@"
    echo "bnx.sh: neither bun nor npx is available for $pkg" >&2
    exit 1
    ;;
esac
