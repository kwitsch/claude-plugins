# dprint

Skill that checks for a minimum dprint version and, after confirmation, installs or updates dprint at user level.

## Install

```
/plugin install dprint@kwitsch-plugins
```

## Skills

| Skill         | What it does                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init-dprint` | Checks whether dprint is installed in at least the minimum version; if it is missing or too old, asks once via `AskUserQuestion` and, only on an explicit yes, installs it or updates it, then re-checks. |

## Notes

- Minimum dprint version: `0.50.0` (the `MIN_VERSION` constant in `skills/init-dprint/check-dprint.mjs`).
- Installs via the official installer (`curl -fsSL https://dprint.dev/install.sh | sh`) to `~/.dprint/bin` — user level, no sudo. Updates use `dprint upgrade`.
- Shell rc files are never edited: if `~/.dprint/bin` is not on `PATH`, the skill prints the `export PATH=...` line to add yourself.
- Linux, macOS and WSL only. Requires `node` on `PATH`.
