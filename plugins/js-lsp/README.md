# js-lsp

## Install

```
/plugin install js-lsp@kwitsch-plugins
```

## What it does

Registers `vtsls` as a JavaScript-only language server (`.js`, `.cjs`, `.mjs`,
`.jsx` — no TypeScript) so Claude's built-in `LSP` tool can jump to definitions,
find references, and surface type errors. vtsls is resolved at runtime via `npx`
at a pinned version (`@vtsls/language-server@0.3.0`), node-only — no launcher
wrapper. You do not need to pre-install it, but **`node` and `npx` must be on
the PATH** Claude Code uses to launch LSP/MCP processes. First launch downloads
the server (cached per version in `~/.npm/_npx` thereafter). The plugin then
enforces LSP-first navigation for JavaScript: it redirects JavaScript code-symbol
searches (Grep/Glob/Bash-grep) to the `LSP` tool and applies a progressive read
gate, scoped to clearly-JavaScript targets and fail-open by design.

On session start it also injects a short, server-agnostic hint reminding Claude
to use the `LSP` tool's symbol search before `grep` for code-symbol names
(camelCase, PascalCase, snake_case, dotted) — the hint is identical across the
LSP plugins so they reinforce one message rather than compete.

## Configuration

Run `/configure js-lsp` (or edit plugin settings):

| Option | Default | Effect |
|--------|---------|--------|
| `enforce_search` | on | Redirect JavaScript code-symbol Grep/Glob/Bash-grep to the LSP tool. |
| `enforce_read_gate` | on | Require an LSP navigation call before reading many JavaScript files. |
