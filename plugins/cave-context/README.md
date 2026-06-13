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

- **MCP proxy** (`mcp/server.mjs`): launches `context-mode` as an upstream server (via the `bin/mjsx.sh` launcher) and re-exposes every `ctx_*` tool verbatim. Clients see the same tool surface as standalone context-mode.
- **Aggregated hooks** (`hooks/hooks.json`): mid-session PreToolUse/PostToolUse are `mcp_tool` hooks that delegate to `hook_*` tools on the same server, fanning out to both caveman and context-mode logic in one round-trip. SessionStart, UserPromptSubmit, PreCompact, and ConfigChange are `command` hooks (each launched through `bin/mjsx.sh` with the `hooks/*.mjs` script as its argument) — each for a specific reason, not a blanket "too early": SessionStart is **pre-connect** (server not up on first run, so `mcp_tool` would fail open); UserPromptSubmit avoids a per-prompt MCP round-trip and must run the level-toggle state mutation every prompt; PreCompact and ConfigChange are **fail-open-sensitive side-effects** (a pre-context-loss snapshot and a live state-write the other command hooks read) that must fire even if the server is momentarily down. SessionStart emits the caveman ruleset as `additionalContext` and seeds the runtime level so per-turn reminders fire from turn 1. ConfigChange re-seeds that level whenever settings change, so a `caveman_level` edit applies live (see Configuration).
- **caveman reimplemented** in `mcp/caveman.mjs` (levels lite/full/ultra, state in `$CLAUDE_PLUGIN_DATA`).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Runtime launcher

All `.mjs` scripts (the MCP server, the command hooks) and the upstream `context-mode` package are launched through `bin/mjsx.sh`, a small bash launcher that owns runtime selection:

- Prepends `~/.local/bin` and `~/.bun/bin` to `PATH` (non-interactive shells often miss these).
- Prefers [bun](https://bun.sh) when `bun` is on `PATH`, otherwise falls back to node / npx.
- Dispatches on its first argument: a `*.mjs` script runs under `bun <script>` (or `node <script>`); an npm package name runs under `bun x <pkg>` (or `npx -y <pkg>`).

The `context-mode` npm package must therefore be reachable via bun or npx. On first call it is downloaded automatically (network required or warm cache); subsequent calls use the cached version.

## Configuration

cave-context reads its options from `pluginConfigs["cave-context"].options` in your `settings.json` (precedence: local `>` project `>` user — i.e. `${CLAUDE_PROJECT_DIR}/.claude/settings.local.json`, then `${CLAUDE_PROJECT_DIR}/.claude/settings.json`, then `~/.claude/settings.json`).

| Option | Default | Effect / Value |
|---|---|---|
| `caveman_level` | `lite` | Default terse-output level injected at session start and used by a bare `/caveman` (no argument) or natural-language activation. Values: `lite`, `full`, `ultra`. Invalid or missing → falls back to `lite`. |

Changes to `caveman_level` apply **live**: cave-context's `ConfigChange` hook re-reads `settings.json` and re-seeds the active level on any settings change, so you don't need to restart the session.

Example (`~/.claude/settings.json`):

```json
{
  "pluginConfigs": {
    "cave-context": {
      "options": { "caveman_level": "full" }
    }
  }
}
```

## Skills

| Skill | What it does |
|---|---|
| `stat` | Show combined cave-context savings (caveman + context-mode) |
