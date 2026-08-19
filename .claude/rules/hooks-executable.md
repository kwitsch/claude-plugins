---
paths:
  - "plugins/*/hooks/*.sh"
  - "plugins/*/hooks/*.mjs"
  - "plugins/*/mcp/*.mjs"
  - "plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp"
---

# Rule: hook files must be executable

All `.sh` and `.mjs` files under `plugins/*/hooks/`, and the MCP server backing a plugin's `mcp_tool` hooks under `plugins/*/mcp/`, MUST have the executable bit set. Claude Code silently skips non-executable hook files, and a non-executable MCP server fails to start — so its `mcp_tool` hook then fails open. Most plugins' `mcp/` server is a self-contained `.mjs` (`#!/usr/bin/env node`); `linux-token-efficiency`'s `mcp/linux-token-efficiency-mcp` is the one exception, a committed compiled Rust ELF binary — the executable-bit requirement applies identically, `#!/usr/bin/env node` line-1 check aside.

**After creating or writing any file in `plugins/*/hooks/` path, immediately run:**

```bash
chmod +x <file>
```

Never leave a hook file without executable bit. Applies to `.sh` and `.mjs` hooks under `hooks/`, every plugin's `mcp/server.mjs`, and `linux-token-efficiency`'s committed `mcp/linux-token-efficiency-mcp` binary.

**Verification:** After any Write or Edit to a `plugins/*/hooks/` or `plugins/*/mcp/` file, confirm with:

```bash
ls -la plugins/<name>/hooks/ plugins/<name>/mcp/
```
