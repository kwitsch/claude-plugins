# Tool routing

Detected on this machine — prefer these over the generic default when available.

| Task | Prefer | Why |
|---|---|---|
| Shell commands (git, gh, npm, …) | `rtk <cmd>` | routes through the Rust Token Killer proxy — token savings on dev-op output |
| JS/TS runtime & package management | `bun` | faster install/run than node/npm |
| Text search | `rg` (ripgrep) | faster, respects .gitignore |
| Code structure exploration (callers, call chains, architecture) | `codebase-memory-mcp` tools | graph-backed, avoids grepping the whole tree |
