# cave-context

Unifies caveman + context-mode into one non-competing MCP server: proxies all `ctx_*` tools 1-to-1 and aggregates both plugins' hooks into a single handler set.

## Install

```
/plugin install cave-context@kwitsch-plugins
```

> **Before installing:** uninstall both `caveman` and `context-mode` first.
> Running cave-context alongside either plugin re-creates hook competition (duplicate PreToolUse/PostToolUse matchers) and spawns a second context-mode MCP server.

## What it does

cave-context replaces the caveman and context-mode plugins with a single component:

- **MCP proxy** (`mcp/server.mjs`): spawns `npx -y context-mode` as an upstream server and re-exposes every `ctx_*` tool verbatim. Clients see the same tool surface as standalone context-mode.
- **Aggregated hooks** (`hooks/hooks.json`): mid-loop PreToolUse/PostToolUse are `mcp_tool` hooks that delegate to `hook_*` tools on the same server, fanning out to both caveman and context-mode logic in one round-trip. Early-lifecycle events — SessionStart, UserPromptSubmit, PreCompact — are `command` hooks (`hooks/*.mjs`), because an `mcp_tool` hook fails open that early (the server is not reliably connected yet). SessionStart emits the caveman ruleset as `additionalContext`.
- **caveman reimplemented** in `mcp/caveman.mjs` (levels lite/full/ultra, state in `$CLAUDE_PLUGIN_DATA`).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Runtime requirement

The `context-mode` npm package must be reachable via `npx`. On first call it is downloaded automatically (network required or warm npm cache). Subsequent calls use the cached version.

## Skills

| Skill | What it does |
|---|---|
| `stat` | Show combined cave-context savings (caveman + context-mode) |
