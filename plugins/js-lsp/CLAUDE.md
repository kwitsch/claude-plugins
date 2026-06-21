# CLAUDE.md — js-lsp

JavaScript-only LSP (vtsls) + LSP-first enforcement (adapted from the
claude-code-lsp-enforcement-kit). Pure `mcp_tool` hooks.

## Behavior
- `.lsp.json` launches vtsls via `bin/vtsls-launch.sh` (vtsls→bun→npx) for
  `.js/.cjs/.mjs/.jsx` only.
- `mcp/server.mjs` exposes `hook_pretooluse`/`hook_posttooluse`; `hooks.json`
  wires PreToolUse (`Grep|Glob|Bash|Read`) and PostToolUse (`LSP`).
- Enforcement is JS-scoped (ambiguous targets pass through) and fail-open
  (soft `mcp_tool` deny; read-gate escape hatch after 2 blocked reads with no
  LSP success). Stale state is reset at server start (first-sighting per cwd).

## Tests
`BATS_LIB_PATH=/usr/lib/bats bats test/js-lsp/` and `node --test test/js-lsp/`.
