# CLAUDE.md — js-lsp

JavaScript-only LSP (vtsls) + LSP-first enforcement (adapted from the
claude-code-lsp-enforcement-kit). `mcp_tool` enforcement hooks + a `SessionStart` cat hint.

## Behavior
- `.lsp.json` launches vtsls via `bin/vtsls-launch.sh` (vtsls→bun→npx) for
  `.js/.cjs/.mjs/.jsx` only.
- `mcp/server.mjs` exposes `hook_pretooluse`/`hook_posttooluse`; `hooks.json`
  wires PreToolUse (`Grep|Glob|Bash|Read`) and PostToolUse (`LSP`).
- `hooks.json` also wires a no-matcher `SessionStart` command hook that `cat`s
  `hooks/SessionStart.md` — a server-agnostic hint to prefer the `LSP` tool's
  `workspaceSymbol` over `grep` for code-symbol names. The hint file
  `hooks/SessionStart.md` is byte-identical across js-lsp/ts-lsp/shell-lsp so the
  plugins reinforce one message.
- Enforcement is JS-scoped (ambiguous targets pass through) and fail-open
  (soft `mcp_tool` deny; read-gate escape hatch after 2 blocked reads). Stale
  state is reset at server start (first-sighting per cwd).

## Tests
`BATS_LIB_PATH=/usr/lib/bats bats test/js-lsp/` and `node --test test/js-lsp/`.
