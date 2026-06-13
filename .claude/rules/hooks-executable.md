---
paths:
  - "plugins/*/hooks/*.sh"
  - "plugins/*/hooks/*.mjs"
  - "plugins/*/mcp/*.mjs"
---

# Rule: hook files must be executable

All `.sh` and `.mjs` files under `plugins/*/hooks/`, and the self-contained MCP server `.mjs` under `plugins/*/mcp/`, MUST have the executable bit set. Claude Code silently skips non-executable hook files, and a non-executable `mcp/server.mjs` fails to start — so its `mcp_tool` hook then fails open.

**After creating or writing any file in `plugins/*/hooks/` path, immediately run:**

```bash
chmod +x <file>
```

Never leave a hook file without executable bit. Applies to `.sh` and `.mjs` hooks under `hooks/` and the `mcp/server.mjs` server.

**Verification:** After any Write or Edit to a `plugins/*/hooks/` or `plugins/*/mcp/` file, confirm with:

```bash
ls -la plugins/<name>/hooks/ plugins/<name>/mcp/
```
