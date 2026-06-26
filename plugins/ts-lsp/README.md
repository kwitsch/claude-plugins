# ts-lsp

## Install

```
/plugin install ts-lsp@kwitsch-plugins
```

## What it does

Registers `vtsls` as a TypeScript-only language server (`.ts`, `.tsx`, `.mts`,
`.cts` — no JavaScript) so Claude's built-in `LSP` tool can jump to definitions,
find references, and surface type errors. vtsls is resolved at runtime via `npx`
at a pinned version (`@vtsls/language-server@0.3.0`), node-only — no launcher
wrapper. You do not need to pre-install it, but **`node` and `npx` must be on
the PATH** Claude Code uses to launch LSP/MCP processes. First launch downloads
the server (cached per version in `~/.npm/_npx` thereafter). The plugin then
enforces LSP-first navigation for TypeScript: it redirects TypeScript code-symbol
searches (Grep/Glob/Bash-grep) to the `LSP` tool and applies a progressive read
gate, scoped to clearly-TypeScript targets and fail-open by design.

This plugin depends on `lsp-base` (auto-enabled, Claude Code ≥ 2.1.143), which
provides the language-agnostic LSP-first rules block (SessionStart) and a
per-prompt reminder (UserPromptSubmit). This plugin's own `SessionStart` carries
only the TypeScript-specific symbol examples.

## Configuration

Run `/configure ts-lsp` (or edit plugin settings):

| Option | Default | Effect |
|--------|---------|--------|
| `enforce_search` | on | Redirect TypeScript code-symbol Grep/Glob/Bash-grep to the LSP tool. |
| `enforce_read_gate` | on | Require an LSP navigation call before reading many TypeScript files. |
