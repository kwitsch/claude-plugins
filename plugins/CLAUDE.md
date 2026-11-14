# CLAUDE.md — plugins/

Conventions for all plugins here.

## Structure

Each plugin: `.claude-plugin/plugin.json` (manifest: `version` plus metadata like `name`/`description`/`userConfig`, and may declare `dependencies`) + components + `README.md` + `CLAUDE.md`. Matching bats suite in `test/<name>/` (see `.claude/rules/test-conventions.md`). The `version` field lives only here — never in `marketplace.json` entries (see `.claude/rules/plugin-versioning.md`).

**Important**: Only `plugin.json` goes inside `.claude-plugin/`, except engine-generated `.claude-plugin/types/` for mods, which is gitignored. All component dirs at plugin root.

Removing or renaming a plugin feature or convention: grep its tokens in `plugins/<name>/`, `.claude/rules/*.md` (path-scoped rules can still mandate it), `plugins/CLAUDE.md`, root `CLAUDE.md` and `.claude/skills/create-plugin/templates/`, and fix contradictions in the same PR.

| Directory/File           | Purpose                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skills/`                | Skills as `<name>/SKILL.md` dirs — **preferred for new plugins**                                                                                                                                                                                                                                                                                                                                 |
| `commands/`              | Skills as flat `.md` files — legacy, avoid for new plugins                                                                                                                                                                                                                                                                                                                                       |
| `agents/`                | Custom agent definitions                                                                                                                                                                                                                                                                                                                                                                         |
| `workflows/`             | Dynamic Workflow-tool scripts (`<name>.workflow.js`), auto-discovered and namespaced as `/<plugin>:<name>`. Excluded from `eslint.config.mjs` (top-level `await`/`return`)                                                                                                                                                                                                                       |
| `hooks/`                 | Event handlers in `hooks.json`, or a mods function-hooks module (`hooks.json` = `{"modules":["./register.ts"]}`, TypeScript, tested via `claude plugin test`; see `plugins/CLAUDE.md` `## Mods function-hooks modules`)                                                                                                                                                                          |
| `mcp/`                   | Self-contained zero-dep MCP stdio server (`server.mjs`) backing `mcp_tool` hooks, invoked directly as the `.mcp.json` `command` (executable `.mjs`, `#!/usr/bin/env node`, `100755`). Documented bundle exception: `universal-format` (committed `bun build` bundle plus `.wasm` sidecars) — see `plugins/universal-format/CLAUDE.md`. Layout and templates: `.claude/rules/hooks-mcp-server.md` |
| `bin/`                   | Executables added to Bash `PATH` when the plugin is enabled; must be `chmod +x` and `100755` in git (`core.fileMode=false` here — see `.claude/rules/bin-executable.md`).                                                                                                                                                                                                                        |
| `.mcp.json`              | MCP server configs                                                                                                                                                                                                                                                                                                                                                                               |
| `.lsp.json`              | LSP server configs for code intelligence                                                                                                                                                                                                                                                                                                                                                         |
| `monitors/monitors.json` | Background monitors (watch logs/files, notify Claude per stdout line)                                                                                                                                                                                                                                                                                                                            |
| `settings.json`          | Default settings when plugin enabled; only `agent` + `subagentStatusLine` keys honored                                                                                                                                                                                                                                                                                                           |
| `output-styles/`         | Output style `.md` files, auto-discovered by directory presence                                                                                                                                                                                                                                                                                                                                  |

## Hooks

Command hook vs `mcp_tool` hook, MCP-server layout and templates: `.claude/rules/hooks-mcp-server.md`; `hooks.json` conventions: `.claude/rules/hooks-json-authoring.md`.

## Mods function-hooks modules

Layout and module rules for mods plugins:

- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — every hook and every `$` use, typed via `import type { EngineInterface, Register } from 'claude-code'`. No `any`, no `import()` (a module holding `import()` does not load). `100644`: the engine imports it.
- `hooks/<logic>.mjs` — pure, zero-dep, JSDoc-typed logic with no clock reads (time comes in as arguments), covered by the root `tsconfig.json`, ESLint and `node --test`. It must never reference `$`: the engine rejects passing the mods API into functions imported from another file. It also rejects `$.<noun>` as a bare value (bound, passed or read), so same-file helpers in `register.ts` take the whole `$` typed `EngineInterface`.
- `tests/<name>.test.ts` — hook-wiring tests for `claude plugin test`. Local only: CI runners have no `claude` CLI; the bats suite runs `claude plugin validate` and `claude plugin test` when `claude` is on `PATH` and skips them otherwise.
- `.claude-plugin/types/` is written by the engine (typings + tsconfig) at every `claude --plugin-dir` load and is gitignored (`plugins/*/.claude-plugin/types/`). No committed per-mod `tsconfig.json`.

## Synced plugins

`dprint`, `inline-headroom`, `universal-lint`, `jevfort`, `jev-api`, `jev-solver` and `graphmind-helper` are developed in kwitsch/claude-plugins-development (`<name>/`, docs in its `<name>/CLAUDE.md`). `plugins/<name>/` here is their synced build output (`Sync <name> <version>` commits pushed by that repo's release workflow): never edit it directly, no bats suite, no `test.yml` matrix entry, excluded from the root `tsconfig.json`. Their marketplace entries carry no display fields (`.claude/rules/marketplace-synced-entries.md`).
