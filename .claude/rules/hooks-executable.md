---
paths:
  - "plugins/*/hooks/*.sh"
  - "plugins/*/hooks/*.mjs"
  - "plugins/*/mcp/*.mjs"
---

# Rule: hook files must be executable

All `.sh` and `.mjs` files under `plugins/*/hooks/`, and the self-contained MCP server `.mjs` under `plugins/*/mcp/`, MUST have the executable bit set. Claude Code silently skips non-executable hook files, and a non-executable `mcp/server.mjs` fails to start — so its `mcp_tool` hook then fails open.

**After creating or writing any `.sh`/`.mjs` file under `plugins/*/hooks/` or any `plugins/*/mcp/*.mjs`, immediately run:**

```bash
chmod +x <file>
git add <file>
git update-index --chmod=+x <file>
```

**`core.fileMode=false` in this repo:** `chmod +x` alone is NOT picked up by `git add`, so git records `100644` — local `[ -x … ]` checks pass but a fresh CI checkout or plugin install gets a non-executable file. `git update-index --chmod=+x` forces the mode. A file renamed with `git mv` from an already-`100755` file keeps its mode.

**Verification:** confirm the index mode, not the working tree — the suite runs before the adding commit exists, and `ls -la` reads only the working tree:

```bash
git ls-files -s plugins/<name>/hooks/<file> plugins/<name>/mcp/server.mjs  # must print 100755
```

Files in `hooks/` that are `cat`-ed or read rather than executed (e.g. `.md`, `.json`) are outside the globs above and stay `100644`.
