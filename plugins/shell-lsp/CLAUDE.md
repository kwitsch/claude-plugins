# CLAUDE.md — shell-lsp

Shell-only LSP (bash-language-server) + LSP-first enforcement (adapted from the
claude-code-lsp-enforcement-kit). `mcp_tool` enforcement hooks + a `SessionStart` cat hint.

## Behavior
- `.lsp.json` launches bash-language-server via `bin/bash-ls-launch.sh` (bun→npx) for
  `.sh/.bash` only.
- `mcp/server.mjs` exposes `hook_pretooluse`/`hook_posttooluse`; `hooks.json`
  wires PreToolUse (`Grep|Glob|Bash|Read`) and PostToolUse (`LSP`).
- `hooks.json` also wires a no-matcher `SessionStart` command hook that `cat`s
  `hooks/SessionStart.md` — a server-agnostic hint to prefer the `LSP` tool's
  `workspaceSymbol` over `grep` for code-symbol names. The hint file
  `hooks/SessionStart.md` is byte-identical across js-lsp/ts-lsp/shell-lsp so the
  plugins reinforce one message.
- Enforcement is shell-scoped (ambiguous targets pass through) and fail-open
  (soft `mcp_tool` deny; read-gate escape hatch after 2 blocked reads). Stale
  state is reset at server start (first-sighting per cwd).

## Known limitation
Extensionless / shebang-only scripts are not covered — target detection is
extension-based (`.sh`/`.bash`); extensionless scripts are a fail-open
pass-through.

## Tests
`BATS_LIB_PATH=/usr/lib/bats bats test/shell-lsp/` and `node --test test/shell-lsp/*.test.mjs`.
