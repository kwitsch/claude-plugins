# CLAUDE.md — cave-context

One MCP server that proxies the context-mode MCP server 1-to-1 and hosts aggregated caveman+context-mode hook handlers. Replaces both plugins.

## Behavior
- `mcp/server.mjs`: spawns `npx -y context-mode` upstream, re-exposes every `ctx_*` tool verbatim, also serves `hook_*` tools.
- `hooks/hooks.json`: SessionStart = `command` hook (`hooks/sessionstart.mjs`) emitting the caveman ruleset as `additionalContext`; UserPromptSubmit + PreCompact = `command` hooks (`hooks/*.mjs`) — `mcp_tool` fails open on early-lifecycle events because the server is not reliably connected yet; PreToolUse + PostToolUse = `mcp_tool` → `hook_*` (mid-loop, server connected).
- caveman reimplemented in `mcp/caveman.mjs` (levels lite/full/ultra, state in `$CLAUDE_PLUGIN_DATA`); context-mode delegated via `npx -y context-mode hook`.
- Reentrancy: PreToolUse/PostToolUse matchers must never match `hook_` tools.

## Tests
`test/cave-context/test.bats` (bats) + `test/cave-context/*.test.mjs` (node --test). Run:
```
BATS_LIB_PATH=/usr/lib/bats bats test/cave-context/
node --test test/cave-context/*.test.mjs
```
