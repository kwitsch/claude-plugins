# cave-context

Unifies caveman + context-mode into one non-competing MCP server: proxies context-mode's `ctx_*` tools and aggregates both plugins' hooks into a single handler set.

## Install

```
/plugin install cave-context@kwitsch-plugins
```

> **Before installing:** uninstall both `caveman` and `context-mode` first.
> Running cave-context alongside either plugin re-creates hook competition (duplicate PreToolUse/PostToolUse matchers) and spawns a second context-mode MCP server.

## What it does

cave-context replaces the caveman and context-mode plugins with a single component:

- **MCP proxy** (`mcp/server.mjs`): launches `context-mode` as an upstream server (via the `bin/bnx.sh` launcher) and re-exposes its `ctx_*` tools, minus `ctx_stats`, `ctx_doctor`, and `ctx_upgrade` (filtered from `tools/list` and rejected on call).
- **Aggregated hooks** (`hooks/hooks.json`): mid-session UserPromptSubmit, PreToolUse, and PostToolUse are `mcp_tool` hooks that delegate to `hook_*` tools on the same server, fanning out to both caveman and context-mode logic in one round-trip. SessionStart and PreCompact are `command` hooks (launched through `bin/bnx.sh` with the `hooks/*.mjs` script as its argument) — each for a specific reason: SessionStart is **pre-connect** (server not up on first run, so `mcp_tool` would fail open); PreCompact is a **fail-open-sensitive side-effect** (a pre-context-loss snapshot) that must fire even if the server is momentarily down. SessionStart emits cave-context's **condensed** caveman ruleset as `additionalContext`, **and** delegates to context-mode to run session-init side-effects (DB init, CLAUDE.md-capture) and restore prior-session continuity on resume/compact — context-mode's routing block is stripped so there is no double-injection. It also runs a **native cache GC** to remove stale sibling version dirs from cave-context's own plugin-cache. `clear` sessions suppress the continuity restore (intentional fresh start). UserPromptSubmit re-emits the per-turn full reminder (its `hook_userpromptsubmit` is `mcp_tool` — a deliberate trade of a per-prompt MCP round-trip + a first-prompt connect race for one fewer shim file).- **caveman reimplemented** in `mcp/caveman.mjs` — fixed at the `full` compression level (no level switching, no off switch, no runtime state).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Runtime launcher

All `.mjs` scripts (the MCP server, the command hooks) and the upstream `context-mode` package are launched through `bin/bnx.sh`, a small bash launcher that owns runtime selection:

- Prepends `~/.local/bin` and `~/.bun/bin` to `PATH` (non-interactive shells often miss these).
- Prefers [bun](https://bun.sh) when `bun` is on `PATH`, otherwise falls back to node / npx.
- Dispatches on its first argument: a `*.mjs` script runs under `bun <script>` (or `node <script>`); an npm package name runs under `bun x <pkg>` (or `npx -y <pkg>`).

The `context-mode` npm package must therefore be reachable via bun or npx. On first call it is downloaded automatically (network required or warm cache); subsequent calls use the cached version.

caveman compression is fixed at the `full` level — there is no `userConfig` to set and no runtime level switching.

## License & attribution

cave-context itself is licensed under the repository's MIT license (© 2026 Kwitsch).

It is a derivative/integration of two upstream plugins:

- **caveman** ([JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)) — MIT, © 2026 Julius Brussee. cave-context's caveman ruleset (`mcp/caveman.mjs`) is adapted from caveman; its MIT notice is reproduced in [`NOTICE`](NOTICE).
- **context-mode** ([mksglu/context-mode](https://github.com/mksglu/context-mode)) — Elastic License 2.0, © 2026 Mert Koseoglu. cave-context proxies/delegates to the `context-mode` npm package at runtime; it **does not bundle context-mode source** (the package is installed separately via bun/npx), so no ELv2 code is redistributed here.
