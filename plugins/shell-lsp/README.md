# shell-lsp

## Install

```
/plugin install shell-lsp@kwitsch-plugins
```

## What it does

Registers `bash-language-server` as a shell-only language server (`.sh`, `.bash`)
so Claude's built-in `LSP` tool can jump to definitions, find references, and
surface errors. bash-language-server is resolved at runtime via a
`bun → npx` wrapper via `bin/bash-ls-launch.sh`, so you do not need to
pre-install it (Node ≥18 or Bun required). The plugin then enforces LSP-first
navigation for shell scripts: it redirects shell code-symbol searches
(Grep/Glob/Bash-grep) to the `LSP` tool and applies a progressive read gate,
scoped to clearly-shell targets and fail-open by design.

## Configuration

Run `/configure shell-lsp` (or edit plugin settings):

| Option | Default | Effect |
|--------|---------|--------|
| `enforce_search` | on | Redirect shell code-symbol Grep/Glob/Bash-grep to the LSP tool. |
| `enforce_read_gate` | on | Require an LSP navigation call before reading many shell files. |

## Known limitation

Extensionless scripts (identified only by shebang, e.g. `#!/bin/bash` with no
`.sh`/`.bash` extension) are **not covered**. Target detection is
extension-based; extensionless scripts pass through without enforcement
(fail-open). Rename to `.sh` or `.bash` to bring them under LSP-first coverage.
