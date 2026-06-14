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

- **MCP proxy** (`mcp/server.mjs`): launches `context-mode` as an upstream server (via the `bin/bnx.sh` launcher) and re-exposes every `ctx_*` tool verbatim. Clients see the same tool surface as standalone context-mode.
- **Aggregated hooks** (`hooks/hooks.json`): mid-session UserPromptSubmit, PreToolUse, and PostToolUse are `mcp_tool` hooks that delegate to `hook_*` tools on the same server, fanning out to both caveman and context-mode logic in one round-trip. SessionStart and PreCompact are `command` hooks (launched through `bin/bnx.sh` with the `hooks/*.mjs` script as its argument) — each for a specific reason: SessionStart is **pre-connect** (server not up on first run, so `mcp_tool` would fail open); PreCompact is a **fail-open-sensitive side-effect** (a pre-context-loss snapshot) that must fire even if the server is momentarily down. SessionStart emits the caveman ruleset as `additionalContext`; UserPromptSubmit re-emits the per-turn full reminder (its `hook_userpromptsubmit` is `mcp_tool` — a deliberate trade of a per-prompt MCP round-trip + a first-prompt connect race for one fewer shim file).
- **caveman reimplemented** in `mcp/caveman.mjs` — fixed at the `full` compression level (no level switching, no off switch, no runtime state).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Runtime launcher

All `.mjs` scripts (the MCP server, the command hooks) and the upstream `context-mode` package are launched through `bin/bnx.sh`, a small bash launcher that owns runtime selection:

- Prepends `~/.local/bin` and `~/.bun/bin` to `PATH` (non-interactive shells often miss these).
- Prefers [bun](https://bun.sh) when `bun` is on `PATH`, otherwise falls back to node / npx.
- Dispatches on its first argument: a `*.mjs` script runs under `bun <script>` (or `node <script>`); an npm package name runs under `bun x <pkg>` (or `npx -y <pkg>`).

The `context-mode` npm package must therefore be reachable via bun or npx. On first call it is downloaded automatically (network required or warm cache); subsequent calls use the cached version.

caveman compression is fixed at the `full` level — there is no `userConfig` to set and no runtime level switching.

## Skills

| Skill | What it does |
|---|---|
| `stat` | Show measured context-mode context-window savings (caveman fixed at full) |
