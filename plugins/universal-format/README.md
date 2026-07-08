# universal-format

Silently auto-formats just-written source files after Write/Edit using each language's standard formatter when it is installed — honoring `.editorconfig` and tool-native configs, and doing nothing when the formatter is absent.

## Install

```
/plugin install universal-format@kwitsch-plugins
```

## What it does

A PostToolUse `Write|Edit` hook (an `mcp_tool` backed by a self-contained plugin-local MCP server) reformats the file Claude just wrote, in place, for six languages. The formatter runs only when its CLI is on `PATH`; a missing formatter, any formatter failure, an unsupported extension, a file outside the project, or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op** — the hook never blocks or degrades the session. When (and only when) formatting actually changed the file, the hook returns a one-line note telling Claude to re-read the file before further string-based edits (so subsequent `Edit` calls don't fail on stale `old_string`).

Per-language opt-out is simply not installing that formatter. The whole plugin can be disabled with the `auto_format` toggle.

## Supported formatters

| Language | Extensions | Formatter chain (first on `PATH` wins) |
|---|---|---|
| Shell | `.sh` `.bash` | `shfmt` |
| Java | `.java` | `google-java-format` → `clang-format` |
| Kotlin | `.kt` `.kts` | `ktlint` → `ktfmt` |
| JS/TS | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | `prettier` → `biome` |
| Python | `.py` `.pyi` | `ruff` → `black` |
| Go | `.go` | `goimports` → `gofmt` |

`prettier` and `biome` additionally run via `npx` when not installed
locally (both are official npm packages). No other formatter in this chain
has an npx fallback — see `CLAUDE.md` for why.

## Configuration

Configure via `/plugin` → installed → **universal-format** → Configure options.

| Option | Default | Effect |
|---|---|---|
| `auto_format` | `true` | Master on/off. Only a literal `false` disables auto-formatting; any other value (or unset) leaves it on. |

## `.editorconfig` support

`.editorconfig` is honored when present; tool-native configs (`.prettierrc*`, `biome.json`, `.clang-format`, `.ruff.toml`, `pyproject.toml [tool.ruff]`/`[tool.black]`) take precedence over it.

- `shfmt`, `ktlint`, `prettier` read `.editorconfig` natively (run flag-free).
- `ktfmt` is always passed `--enable-editorconfig`.
- For `google-java-format`, `clang-format`, `ruff`, `black`, and `biome`, a minimal built-in resolver maps core `.editorconfig` properties (`indent_style`, `indent_size`, `max_line_length`, `end_of_line`) to CLI flags — **only** when no tool-native config governs the file. This mapping is intentionally partial (documented properties only).
- **Hard conflicts are skipped, not violated:** if `.editorconfig` declares a style a fixed-style tool cannot produce (`indent_style = tab` for `google-java-format`/`black`; `google-java-format` is also fixed at 100 columns and 2/4-space indent), the file is left untouched rather than reformatted against its own config.
- Go's style is fixed by design (tabs); a conforming `[*.go] indent_style = tab` is honored by construction.
