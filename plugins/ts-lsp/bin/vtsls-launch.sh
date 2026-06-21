#!/usr/bin/env bash
# vtsls launcher for the ts-lsp plugin.
# Resolution order: vtsls on PATH -> bun global install -> npx fallback.
# stdout MUST stay clean (it is the LSP stdio channel); all messages go to stderr.
set -euo pipefail

# Claude Code launches LSP servers with a non-interactive PATH that often lacks
# ~/.local/bin and ~/.bun/bin; prepend them so bun/node/npx — and a previously
# bun-installed vtsls — are findable. Use ${HOME}, never ~ (~ does not expand
# inside quotes / some non-interactive shells). Mirrors cave-context bin/bnx.sh.
export PATH="${HOME:-}/.local/bin:${HOME:-}/.bun/bin${PATH:+:${PATH}}"

PKG="@vtsls/language-server"   # pulls typescript transitively via @vtsls/language-service

# 1) Already installed?
if command -v vtsls >/dev/null 2>&1; then
  exec vtsls "$@"
fi

# 2) bun available -> global install, then exec.
if command -v bun >/dev/null 2>&1; then
  echo "ts-lsp: vtsls not found; installing $PKG via bun..." >&2
  bun add -g "$PKG" >&2 || echo "ts-lsp: 'bun add -g' failed; will try npx" >&2
  BUN_BIN="$(bun pm bin -g 2>/dev/null || true)"
  if [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN/vtsls" ]; then
    exec "$BUN_BIN/vtsls" "$@"
  fi
  if command -v vtsls >/dev/null 2>&1; then
    exec vtsls "$@"
  fi
  echo "ts-lsp: bun bin path not found; falling back to npx..." >&2
fi

# 3) npx fallback (resolves the single-bin package correctly).
if command -v npx >/dev/null 2>&1; then
  exec npx -y "$PKG" "$@"
fi

echo "ts-lsp: none of vtsls, bun, or npx is available. Install Node.js (>=18) or Bun." >&2
exit 1
