#!/usr/bin/env bash
# bash-language-server launcher for the shell-lsp plugin.
# Resolution order: bash-language-server on PATH -> bun global install -> npx fallback.
# stdout MUST stay clean (it is the LSP stdio channel); all messages go to stderr.
set -euo pipefail

# Claude Code launches LSP servers with a non-interactive PATH that often lacks
# ~/.local/bin and ~/.bun/bin; prepend them so bun/node/npx — and a previously
# bun-installed server — are findable. Use ${HOME}, never ~.
export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin${PATH:+:${PATH}}"

PKG="bash-language-server"

# 1) Already installed?
if command -v bash-language-server >/dev/null 2>&1; then
  exec bash-language-server "$@"
fi

# 2) bun available -> global install, then exec.
if command -v bun >/dev/null 2>&1; then
  echo "shell-lsp: bash-language-server not found; installing $PKG via bun..." >&2
  bun add -g "$PKG" >&2 || echo "shell-lsp: 'bun add -g' failed; will try npx" >&2
  BUN_BIN="$(bun pm bin -g 2>/dev/null || true)"
  if [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN/bash-language-server" ]; then
    exec "$BUN_BIN/bash-language-server" "$@"
  fi
  if command -v bash-language-server >/dev/null 2>&1; then
    exec bash-language-server "$@"
  fi
  echo "shell-lsp: bun bin path not found; falling back to npx..." >&2
fi

# 3) npx fallback (resolves the single-bin package correctly).
if command -v npx >/dev/null 2>&1; then
  exec npx -y "$PKG" "$@"
fi

echo "shell-lsp: none of bash-language-server, bun, or npx is available. Install Node.js (>=16) or Bun." >&2
exit 1
