# ts-lsp

## Install

```
/plugin install ts-lsp@kwitsch-plugins
```

## What it does

Registers `vtsls` as a TypeScript-only language server (`.ts`, `.tsx`, `.mts`,
`.cts` — no JavaScript) so Claude's built-in `LSP` tool can jump to definitions,
find references, and surface type errors. vtsls is resolved at runtime via a
`bun → npx` wrapper, so you do not need to pre-install it (Node ≥18 or Bun
required). The plugin then enforces LSP-first navigation for TypeScript: it
redirects TypeScript code-symbol searches (Grep/Glob/Bash-grep) to the `LSP`
tool and applies a progressive read gate, scoped to clearly-TypeScript targets
and fail-open by design.

## Configuration

Run `/configure ts-lsp` (or edit plugin settings):

| Option | Default | Effect |
|--------|---------|--------|
| `enforce_search` | on | Redirect TypeScript code-symbol Grep/Glob/Bash-grep to the LSP tool. |
| `enforce_read_gate` | on | Require an LSP navigation call before reading many TypeScript files. |
