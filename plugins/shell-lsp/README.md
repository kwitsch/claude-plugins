# shell-lsp

## Install

```
/plugin install shell-lsp@kwitsch-plugins
```

## What it does

Registers `bash-language-server` as a shell-only language server (`.sh`, `.bash`)
so Claude's built-in `LSP` tool can jump to definitions, find references, and
surface errors. bash-language-server is resolved at runtime via `npx` at a
pinned version (`bash-language-server@5.6.0`), node-only — no launcher wrapper.
You do not need to pre-install it, but **`node` and `npx` must be on the PATH**
Claude Code uses to launch LSP/MCP processes. First launch downloads the server
(cached per version in `~/.npm/_npx` thereafter). The plugin then enforces
LSP-first navigation for shell scripts: it redirects shell code-symbol searches
(Grep/Glob/Bash-grep) to the `LSP` tool and applies a progressive read gate,
scoped to clearly-shell targets and fail-open by design.

On session start it also injects a short, server-agnostic hint reminding Claude
to use the `LSP` tool's symbol search before `grep` for code-symbol names
(camelCase, PascalCase, snake_case, dotted) — the hint is identical across the
LSP plugins so they reinforce one message rather than compete.

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
