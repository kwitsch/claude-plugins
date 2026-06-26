# CLAUDE.md — ts-lsp

TypeScript-only LSP (vtsls) + LSP-first enforcement (adapted from the
claude-code-lsp-enforcement-kit). `mcp_tool` enforcement hooks + a `SessionStart` cat hint.

## Behavior
- `.lsp.json` launches vtsls via `npx -y @vtsls/language-server@0.3.0` (pinned,
  node-only, no wrapper) for `.ts/.tsx/.mts/.cts` only.
- `.mcp.json` runs `mcp/server.mjs` directly (no wrapper); `server.mjs` exposes
  `hook_pretooluse`/`hook_posttooluse`; `hooks.json` wires PreToolUse
  (`Grep|Glob|Bash|Read`) and PostToolUse (`LSP`).
- Depends on `lsp-base` (`"dependencies": ["lsp-base"]`, auto-enabled, Claude Code
  ≥ 2.1.143), which provides the language-agnostic LSP-first rules block (SessionStart)
  and a per-prompt reminder (UserPromptSubmit). This plugin's own `hooks/SessionStart.md`
  now carries only the language-specific symbol examples.
- The PreToolUse enforcement messages are word-identical across js-lsp/ts-lsp/shell-lsp
  (neutral `lsp:` prefix), pinned by `test/js-lsp/messages.test.mjs`.
- Enforcement is TS-scoped (ambiguous targets pass through) and fail-open
  (soft `mcp_tool` deny; read-gate escape hatch after 2 blocked reads). Stale
  state is reset at server start (first-sighting per cwd).

## Tests
`BATS_LIB_PATH=/usr/lib/bats bats test/ts-lsp/` and `node --test test/ts-lsp/`.
