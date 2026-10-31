# dprint

Skill that checks for a minimum dprint version, installs or updates dprint at user level after confirmation, and offers to add dprint plugins for file types the project's dprint config does not cover. Also formats every Write and Edit with the project's dprint config via a PreToolUse hook (MCP server dprint-hooks; needs node and dprint >= 0.50 on PATH).

## Install

```text
/plugin install dprint@kwitsch-plugins
```

## Skills

| Skill         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init-dprint` | Checks whether dprint is installed in at least the minimum version; if it is missing or too old, asks once via `AskUserQuestion` and, only on an explicit yes, installs it or updates it, then re-checks. With a usable dprint it then scans the project's file types (`git ls-files`) and asks once per file type the dprint config does not cover whether to add a matching plugin; when several plugins fit, you pick one. |

## Hooks

| Event                    | What it does                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PreToolUse `Write\|Edit` | `format_pre` (MCP server `dprint-hooks`) formats the file with the project's own dprint config via `dprint lsp` before it lands on disk. Write: the whole content. Edit: only the edited lines (range formatting, whole-file fallback trimmed to the edit), returned as a small `old_string`/`new_string` edit. |

## Notes

- Minimum dprint version: `0.50.0` (the `MIN_VERSION` constant in `src/skills/init-dprint/check-dprint.mts`).
- Installs via the official installer (`curl -fsSL https://dprint.dev/install.sh | sh`) to `~/.dprint/bin` — user level, no sudo. Updates use `dprint upgrade`.
- Shell rc files are never edited: if `~/.dprint/bin` is not on `PATH`, the skill prints the `export PATH=...` line to add yourself.
- Linux, macOS and WSL only. Requires `node` on `PATH`.
- The plugin list is `skills/init-dprint/dprint-plugins.json`, a snapshot of the plugins.dprint.dev registry (date in the file).
- Plugins are added with `dprint config add <name>`, which needs network access and resolves the latest version.
- Only the config in the project root is checked. Plugins of `extends` configs and non-registry plugins (for example `exec`) are not recognized.
- The scan needs `git`.
- The format hook needs dprint >= 0.50 (`dprint lsp`) on `PATH` or in `~/.dprint/bin` and `node` on `PATH`. Without dprint, or on any error or timeout (30 s per request), the Write/Edit goes through unformatted.
- Which files are formatted is decided by dprint's config (plugins, includes, excludes); unmatched files are left alone.
- One `dprint lsp` process runs per working directory; `CwdChanged`, `EnterWorktree` and `ExitWorktree` hooks re-root the session/agent. Edits to CRLF files are formatted on the LF view Claude Code matches against; the file keeps its CRLF line endings. Files outside the working directory, under `node_modules`, `vendor`, `.git`, `.claude/worktrees`, `.claude/agent-memory`, and `*.local.*` files are never formatted.
- The first format in a project may download dprint plugins and time out; later calls succeed.
