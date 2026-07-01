---
name: codebase-repo-init
description: Indexes the repo into codebase-memory-mcp's knowledge graph. Checks MCP tool availability via ToolSearch; skips gracefully if codebase-memory-mcp is not connected.
allowed-tools: ["ToolSearch"]
---

# codebase-repo-init

Index the repo into codebase-memory-mcp's knowledge graph.
Skips gracefully if the codebase-memory-mcp MCP server is not connected.

## Steps

### 1. Check MCP tool availability

Run `ToolSearch(query: "select:mcp__codebase-memory-mcp__index_repository")`.

If the tool schema is NOT returned:
- Report: "codebase-memory-mcp MCP server not connected — skipping".
- Stop.

### 2. Index the repository

Call `mcp__codebase-memory-mcp__index_repository` with:
```json
{ "repo_path": "." }
```

Report: "indexed" (or the tool's returned status).
