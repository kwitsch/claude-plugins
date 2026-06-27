---
name: codebase-repo-init
description: Ensures the repo has a codebase-memory index and .codebase-memory/.gitignore. Checks MCP tool availability via ToolSearch; skips gracefully if codebase-memory-mcp is not connected. Idempotent — if already indexed, only checks/fixes the gitignore.
allowed-tools: ["Bash", "Write", "ToolSearch"]
---

# codebase-repo-init

Ensure the repo has a codebase-memory index and a correct `.codebase-memory/.gitignore`.
Skips gracefully if the codebase-memory-mcp MCP server is not connected.

## Precondition (dynamic-context injection)

```!
[ -d .codebase-memory ] && echo "CBMCP_DIR_EXISTS=yes" || echo "CBMCP_DIR_EXISTS=no"
```

`CBMCP_AVAILABLE` (MCP tool reachability) cannot be probed from bash at load time —
it is determined at runtime via ToolSearch in step 1.

## Steps

### 1. Check MCP tool availability

Run `ToolSearch(query: "select:mcp__codebase-memory-mcp__index_repository")`.

If the tool schema is NOT returned:
- Report: "codebase-memory-mcp MCP server not connected — skipping".
- Stop.

### 2. Index if not yet indexed (`CBMCP_DIR_EXISTS=no`)

Call `mcp__codebase-memory-mcp__index_repository` with:
```json
{ "repo_path": ".", "persist": true }
```

After the call returns, create `.codebase-memory/.gitignore` with this exact content:
```
# local runtime database — rebuilt from graph.db.zst on first checkout
graph.db
```

Report: "indexed and .codebase-memory/.gitignore created".

### 3. Already indexed (`CBMCP_DIR_EXISTS=yes`)

Check `.codebase-memory/.gitignore`:
- If the file is missing or does not contain `graph.db` → write the canonical
  two-line content above (see step 2).
- Report: "already indexed; gitignore checked/updated" (or "already complete").
