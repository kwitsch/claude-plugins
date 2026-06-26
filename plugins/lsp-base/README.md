# lsp-base

Shared LSP-first guidance for the LSP language plugins. Hooks only — no LSP or MCP server.

## What it does

- **SessionStart** `cat`s `hooks/SessionStart.md` — the language-agnostic LSP-first code-intelligence rules block (search-redirection + read-gate are *enforced* by the language plugins; pre-edit / pre-refactor / post-edit discipline is *advisory*).
- **UserPromptSubmit** `cat`s `hooks/PromptReminder.md` — a one-line per-prompt reminder.

## Why a separate plugin

`js-lsp`, `ts-lsp`, and `shell-lsp` declare `"dependencies": ["lsp-base"]`, so enabling
any of them auto-enables `lsp-base` (Claude Code **≥ 2.1.143**). The shared rules and
reminder are then defined once here instead of duplicated across each plugin; each
language plugin adds only its language-specific symbol examples plus enforcement.

You can also enable `lsp-base` on its own for the guidance without any enforcement.

## Requirements

- Claude Code ≥ 2.1.143 (plugin dependency auto-enable cascade).
