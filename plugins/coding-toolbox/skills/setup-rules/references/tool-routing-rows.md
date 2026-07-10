# Tool-routing candidate rows

Canonical, single-source-of-truth candidate rows for coding-toolbox's
tool-routing rule (`~/.claude/rules/coding-toolbox-tools.md`). Read by both
`setup-rules` (install/refresh/remove, user-only) and `refresh-tools-rule`
(refresh-only, model-invocable) when writing the heredoc table — never
inlined twice, so there is exactly one place to add, remove, or reword a
tool.

Include only the rows whose tool is in `detected`, each as one line of the
heredoc before its closing `EOF`, verbatim, in this order:

| Tool | Row |
|---|---|
| rtk | `| Shell commands (git, gh, npm, …) | \`rtk <cmd>\` | routes through the Rust Token Killer proxy — token savings on dev-op output |` |
| bun | `| JS/TS runtime & package management | \`bun\` | faster install/run than node/npm |` |
| ripgrep | `| Text search | \`rg\` (ripgrep) | faster, respects .gitignore |` |
| codebase-memory | `| Code structure exploration (callers, call chains, architecture) | \`codebase-memory-mcp\` tools | graph-backed, avoids grepping the whole tree |` |
