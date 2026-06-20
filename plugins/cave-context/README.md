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
- **Aggregated hooks** (`hooks/hooks.json`): mid-session UserPromptSubmit, PreToolUse, PostToolUse, and PreCompact are `mcp_tool` hooks that delegate to `hook_*` tools on the same server. SessionStart has two `command` hooks (both `command` because SessionStart is **pre-connect** — the MCP server is not up on first run, so `mcp_tool` would fail open): (1) `bin/bnx.sh` running `hooks/sessionstart.mjs` — does **not** emit the caveman ruleset; it only delegates to context-mode to run session-init side-effects (DB init, CLAUDE.md-capture) and restore prior-session continuity on resume/compact (context-mode's routing block is stripped so there is no double-injection). context-mode's storage root is set to `${CLAUDE_PLUGIN_DATA}/context-mode` (persistent — survives plugin updates) for both the upstream MCP server and the hook delegate, so its data no longer churns across versioned cache dirs. On resume/compact its `additionalContext` carries the restored continuity payload; on a fresh start (or `clear`) the hook omits the `hookSpecificOutput` envelope entirely and emits `{}` — it never emits `additionalContext: null` (which fails Claude Code's output-schema validation). `clear` sessions suppress the continuity restore (intentional fresh start). (2) a `cat` of `hooks/SessionStart.md` — the **sole source** of the caveman ruleset plus cave-context-adapted context-mode routing rules, injected on every trigger. PreCompact is `mcp_tool` → `hook_precompact` (mid-session, server connected) — delegates context-mode's pre-context-loss resume snapshot; **best-effort**: fails open if the server is momentarily down at compact time (an accepted tradeoff — the delegated snapshot is not a hard gate). UserPromptSubmit re-emits the per-turn full reminder (its `hook_userpromptsubmit` is `mcp_tool` — a deliberate trade of a per-prompt MCP round-trip + a first-prompt connect race for one fewer shim file). **caveman reimplemented** in `mcp/caveman.mjs` — fixed at the `full` compression level (no level switching, no off switch, no runtime state).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Skills

| Skill | What it does |
|---|---|
| `cave-compress` | Compress one Markdown file in place using the caveman terse-encoding ruleset — cuts prose tokens while preserving every fact and verbatim region (code, paths, URLs, numbers, frontmatter). Model- and user-invocable (`/cave-compress <path/to/file.md>`); its `description`/`when_to_use` hint the eligible paths so the model knows when to apply it. Auto-allows `**/CLAUDE.md`, `docs/**/*.md`, `plan/**/*.md`; any other `.md` requires explicit confirmation, and the file must have a git restore point before the lossy overwrite. |

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
