# Tool-routing candidate rows

Canonical, single-source-of-truth candidate rows for coding-toolbox's
tool-routing rule (`~/.claude/rules/coding-toolbox-tools.md`). Read by both
`setup-rules` (install/refresh/remove, user-only) and `refresh-tools-rule`
(refresh-only, model-invocable) when writing the heredoc table — never
inlined twice, so there is exactly one place to add, remove, or reword a
tool.

For each tool in `detected`, emit its row below as one line of the heredoc,
in this order — copy only the fenced line itself (the exact text between the
` ``` ` markers), never the `### <tool>` heading or the fence markers:

<!-- markdownlint-disable-next-line MD001 -- heading level intentionally ### here; the literal "### <tool>" text is referenced by name in coding-toolbox/CLAUDE.md and must not change -->
### rtk

```
| Shell commands (git, gh, npm, …) | `rtk <cmd>` | routes through the Rust Token Killer proxy — token savings on dev-op output |
```

### bun

```
| JS/TS runtime & package management | `bun` | faster install/run than node/npm |
```

### ripgrep

```
| Text search | `rg` (ripgrep) | faster, respects .gitignore |
```

### codebase-memory

```
| Code structure exploration (callers, call chains, architecture) | `codebase-memory-mcp` tools | graph-backed, avoids grepping the whole tree |
```
