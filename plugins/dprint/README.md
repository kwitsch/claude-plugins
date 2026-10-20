# dprint

Skill that checks for a minimum dprint version, installs or updates dprint after confirmation, and offers to create a .dprint.jsonc from existing style configs.

## Install

```
/plugin install dprint@kwitsch-plugins
```

## Skills

| Skill         | What it does                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init-dprint` | Checks whether dprint is installed in at least the minimum version; if it is missing or too old, asks once via `AskUserQuestion` and, only on an explicit yes, installs it or updates it, then re-checks. Then, if the working directory has no dprint config, offers to create a starter `.dprint.jsonc` and asks per style config (`.editorconfig`, `.gitattributes`, Prettier) whether to adopt its settings. |

## Notes

- Minimum dprint version: `0.50.0` (the `MIN_VERSION` constant in `skills/init-dprint/scripts/check-dprint.mjs`).
- Installs via the official installer (`curl -fsSL https://dprint.dev/install.sh | sh`) to `~/.dprint/bin` — user level, no sudo. Updates use `dprint upgrade`.
- Shell rc files are never edited: if `~/.dprint/bin` is not on `PATH`, the skill prints the `export PATH=...` line to add yourself.
- Config step: an existing dprint config (`dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`, or `dprint.json` / `dprint.jsonc` in `.config/`) is reported and never touched. A new `.dprint.jsonc` is written only after an explicit `Create` answer. It carries only dprint's global keys (`lineWidth`, `indentWidth`, `useTabs`, `newLineKind`), copied once from the adopted sources, plus `"plugins": []`; add formatter plugins with `dprint add <plugin>`.
- Linux, macOS and WSL only. Requires `node` on `PATH`.
