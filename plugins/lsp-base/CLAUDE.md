# CLAUDE.md — lsp-base

Shared LSP-first guidance plugin. Hooks only (no LSP/MCP server, no userConfig).

## Behavior
- `hooks.json` wires two command hooks: a no-matcher `SessionStart` that `cat`s
  `hooks/SessionStart.md` (the language-agnostic core LSP-first rules block) and a
  no-matcher `UserPromptSubmit` that `cat`s `hooks/PromptReminder.md` (a one-line
  per-prompt reminder).
- `SessionStart.md` separates **enforced** guidance (symbol-search redirection +
  read-gate, which the language plugins enforce) from **advisory** discipline (pre-edit
  `goToDefinition`, pre-refactor `findReferences`, post-edit re-verification). The
  `LSP` tool exposes no diagnostics op, so post-edit error detection defers to the
  project's typecheck/build.
- Depended on by `js-lsp`, `ts-lsp`, `shell-lsp` via `"dependencies": ["lsp-base"]`
  (auto-enable cascade, Claude Code ≥ 2.1.143).

## Tests
`BATS_LIB_PATH=/usr/lib/bats bats test/lsp-base/`
