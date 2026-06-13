# cave-context

Unifies caveman + context-mode into one non-competing MCP server: proxies all context-mode ctx_* tools 1-to-1 and aggregates both plugins' hooks.

## Install

```
/plugin install cave-context@kwitsch-plugins
```

## What it does

cave-context bridges the caveman compression plugin and the context-mode indexing plugin, routing all `ctx_*` tool calls through a unified MCP server while merging the hook configurations from both plugins so they coexist without conflicts.
