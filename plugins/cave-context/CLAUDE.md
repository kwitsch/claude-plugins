# CLAUDE.md — cave-context

One MCP server that proxies the context-mode MCP server 1-to-1 and hosts aggregated caveman+context-mode hook handlers. Replaces both plugins.

## Behavior
- **Runtime launcher** `bin/mjsx.sh` (chmod +x) owns runtime selection — every `.mjs` (server + command hooks) and the upstream `context-mode` package launch through it. It prepends `${HOME}/.local/bin` + `${HOME}/.bun/bin` to PATH (use `${HOME}`, never `~`), detects bun via `command -v bun`, and dispatches on the first arg: a `*.mjs` → `bun <script>` (else `node <script>`); an npm package → `bun x <pkg>` (else `npx -y <pkg>`). No arg → stderr + exit 64. `.mcp.json` + the three command hooks in `hooks.json` use exec form `command: bin/mjsx.sh`, `args: [<.mjs or pkg>]`.
- `mcp/server.mjs`: launches `context-mode` upstream (via `mjsx.sh`, default `proxy.mjs` cmd resolved with `import.meta.url`), re-exposes every `ctx_*` tool verbatim, also serves `hook_*` tools. **No in-file bun re-exec shim** — `mjsx.sh` owns runtime selection; the module just calls `startServer()`.
- `hooks/hooks.json`: SessionStart = `command` hook (`hooks/sessionstart.mjs` via `mjsx.sh`) — seeds runtime state `writeLevel(stateDir(), configuredDefaultLevel())` so per-turn reminders fire from turn 1, then emits the caveman ruleset as `additionalContext`; UserPromptSubmit + PreCompact = `command` hooks (`hooks/*.mjs` via `mjsx.sh`) — `mcp_tool` fails open on early-lifecycle events because the server is not reliably connected yet; PreToolUse + PostToolUse = `mcp_tool` → `hook_*` (mid-loop, server connected); ConfigChange = `command` hook (`hooks/configchange.mjs` via `mjsx.sh`) — on any settings change it re-seeds the state file from `configuredDefaultLevel()` so a `caveman_level` edit applies live without a session restart (reacts only, exit 0 — never blocks the change).
- caveman reimplemented in `mcp/caveman.mjs` (levels lite/full/ultra, **default level from userConfig `caveman_level`**, default `lite`). `configuredDefaultLevel()` reads `pluginConfigs["cave-context"].options.caveman_level` from settings.json, precedence local `>` project `>` user (`${CLAUDE_PROJECT_DIR}/.claude/settings.local.json`, `${CLAUDE_PROJECT_DIR}/.claude/settings.json`, `${HOME}/.claude/settings.json`); fail-open — any missing file/parse error/missing key/invalid value → `DEFAULT_LEVEL` (`lite`), never throws. Bare `/caveman` + natural-language activate resolve through it; `sessionprompt.mjs` builds the ruleset at it. context-mode delegated via `mjsx.sh context-mode hook claude-code <event>` (default `delegate.mjs` cmd resolved with `import.meta.url`). Platform token `claude-code` and **lowercase** event keys (`pretooluse`/`posttooluse`/`precompact`/`sessionstart`/`userpromptsubmit`) verified against context-mode 1.0.162 `cli.bundle.mjs` routing map — the CLI `process.exit(1)`s silently on an unknown platform/event key, so `delegate.mjs` lowercases the event before invoking it.
- Reentrancy: PreToolUse/PostToolUse matchers must never match `hook_` tools.

## Tests
`test/cave-context/test.bats` (bats) + `test/cave-context/*.test.mjs` (node --test). Run:
```
BATS_LIB_PATH=/usr/lib/bats bats test/cave-context/
node --test test/cave-context/*.test.mjs
```
