# universal-format

Silently auto-formats just-written source files after Write/Edit using each language's standard formatter when it is installed — honoring `.editorconfig` and tool-native configs, and doing nothing when the formatter is absent.

## Install

```
/plugin install universal-format@kwitsch-plugins
```

## What it does

A synchronous PostToolUse `Write|Edit` command hook (no MCP server — the plugin has exactly one hook) reformats the file Claude just wrote, in place, for twelve languages. The formatter runs when its CLI is on `PATH` — or, for `prettier`/`biome`, via the `npx` fallback (see below); an unavailable formatter (no `PATH` CLI and no `npx` fallback), any formatter failure, an unsupported extension, a file outside the project, or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op** — the hook never blocks or degrades the session. When (and only when) formatting actually changed the file, the hook returns a one-line note telling Claude to re-read the file before further string-based edits (so subsequent `Edit` calls don't fail on stale `old_string`) and that the reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules — it should not be reverted or redone by hand to shrink the diff.

This hook is always active once the plugin is installed — there is no toggle. Per-language opt-out is simply not installing that formatter.

## Supported formatters

| Language | Extensions                                            | Formatter chain (first on `PATH` wins) |
| -------- | ----------------------------------------------------- | -------------------------------------- |
| Shell    | `.sh` `.bash`                                         | `shfmt`                                |
| Java     | `.java`                                               | `google-java-format` → `clang-format`  |
| Kotlin   | `.kt` `.kts`                                          | `ktlint` → `ktfmt`                     |
| JS/TS    | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | `prettier` → `biome`                   |
| Python   | `.py` `.pyi`                                          | `ruff` → `black`                       |
| Go       | `.go`                                                 | `goimports` → `gofmt`                  |
| JSON     | `.json`                                               | `prettier` → `biome`                   |
| YAML     | `.yaml` `.yml`                                        | `prettier`                             |
| Markdown | `.md`                                                 | `prettier`                             |
| CSS      | `.css`                                                | `prettier` → `biome`                   |
| SCSS     | `.scss`                                               | `prettier`                             |
| PHP      | `.php`                                                | `php-cs-fixer`                         |

`prettier` and `biome` additionally run via `npx` when not installed
locally (both are official npm packages) — this also covers their
JSON/YAML/Markdown/CSS/SCSS chain entries. No other formatter in this chain
has an npx fallback — see `CLAUDE.md` for why.

## `.editorconfig` support

`.editorconfig` is honored when present; tool-native configs (`.prettierrc*`, `biome.json`, `.clang-format`, `.ruff.toml`, `pyproject.toml [tool.ruff]`/`[tool.black]`) take precedence over it.

- `shfmt`, `ktlint`, `prettier` read `.editorconfig` natively (run flag-free).
- `ktfmt` is always passed `--enable-editorconfig`.
- For `google-java-format`, `clang-format`, `ruff`, `black`, and `biome`, a minimal built-in resolver maps core `.editorconfig` properties (`indent_style`, `indent_size`, `max_line_length`, `end_of_line`) to CLI flags — **only** when no tool-native config governs the file. This mapping is intentionally partial (documented properties only).
- **Hard conflicts are skipped, not violated:** if `.editorconfig` declares a style a fixed-style tool cannot produce (`indent_style = tab` for `google-java-format`/`black`; `google-java-format` is also fixed at 100 columns and 2/4-space indent), the file is left untouched rather than reformatted against its own config.
- Go's style is fixed by design (tabs); a conforming `[*.go] indent_style = tab` is honored by construction.

## YAML/JSON: no line-length limit without a project config

`prettier`'s own default `printWidth` (80) reflows long JSON/YAML arrays and
flow mappings onto multiple lines even when the project never asked for an
80-column limit. When formatting `.yaml`/`.yml`/`.json`, this hook now leaves
`printWidth` unbounded unless the project set a real preference itself — a
`.prettierrc`/`prettier.config.*`/`package.json` `"prettier"` key, or
`.editorconfig`'s `max_line_length` (which `prettier` already honors
natively). Markdown is unaffected: `prettier`'s default `proseWrap` already
never rewraps prose, so there was nothing to fix there.
