# universal-format

Silently auto-formats source files around Write/Edit using each language's standard formatter — Prettier languages before the write with the Prettier the plugin ships inside its own MCP server, everything else after it — honoring `.editorconfig`, `.prettierignore`/`.gitignore` and tool-native configs, and doing nothing when no formatter can be found.

## Install

```
/plugin install universal-format@kwitsch-plugins
```

## What it does

Two `Write|Edit` hooks on a self-contained plugin-local MCP server.

**Prettier languages** (JS/TS, JSON, YAML, Markdown, CSS, SCSS) are formatted **before** the write,
in-process, by the Prettier this plugin ships inside its own MCP server. There is no version
lookup and no install step: one bundled copy, always used, with no network access.

**All other languages** (Shell, Java, Kotlin, Python, Go, PHP) are formatted after the write via
each tool's CLI.

Your project's Prettier **configuration** is still honored in full — `.prettierrc*`,
`prettier.config.*`, a top-level `"prettier"` key in `package.json`/`package.yaml`,
`.editorconfig`, and `.prettierignore`/`.gitignore`.

Two consequences worth knowing:

- **The bundled Prettier version is used even when your project pins a different one.** Formatting
  differences between Prettier minors are real, so your own `prettier --check` may disagree with
  what this plugin wrote. Exclude the paths via `.prettierignore` if that matters.
- **A `plugins:` entry your project's config names must be resolvable from the project.** Entries
  are resolved against the session's working directory; if one cannot be resolved, the file is left
  **unformatted** rather than formatted without the plugin you asked for.

An unavailable formatter, any failure, an unsupported extension, a file outside the project, a file
under `node_modules/`/`vendor/`/`.git/`, or a path excluded by the project's
`.prettierignore`/`.gitignore` is a **silent no-op** — the hooks never block or degrade the session.
When formatting changed the file, the hook returns a one-line note telling Claude to re-read it
before further string-based edits, and that the reformat is intentional and exempt from
"surgical/minimal-diff" change-scope rules.

This plugin is always active once installed — there is no toggle, and there is no per-language
switch. For every formatter except Prettier, not installing the tool is the opt-out. **Prettier is
the exception:** it is bundled, so removing Prettier from your project does not opt out of Prettier
formatting — exclude the paths via `.prettierignore` instead.

## Supported formatters

| Language | Extensions                                            | Formatter chain                                   |
| -------- | ----------------------------------------------------- | ------------------------------------------------- |
| Shell    | `.sh` `.bash`                                         | `shfmt`                                           |
| Java     | `.java`                                               | `google-java-format` → `clang-format`             |
| Kotlin   | `.kt` `.kts`                                          | `ktlint` → `ktfmt`                                |
| JS/TS    | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | bundled `prettier` (in-process, before the write) |
| Python   | `.py` `.pyi`                                          | `ruff` → `black`                                  |
| Go       | `.go`                                                 | `goimports` → `gofmt`                             |
| JSON     | `.json`                                               | bundled `prettier` (in-process, before the write) |
| YAML     | `.yaml` `.yml`                                        | bundled `prettier` (in-process, before the write) |
| Markdown | `.md`                                                 | bundled `prettier` (in-process, before the write) |
| CSS      | `.css`                                                | bundled `prettier` (in-process, before the write) |
| SCSS     | `.scss`                                               | bundled `prettier` (in-process, before the write) |
| PHP      | `.php`                                                | `php-cs-fixer`                                    |

`prettier` is the copy bundled into the plugin's own MCP server — it is never looked up on `PATH`,
never installed, and never fetched. This covers the JS/TS, JSON, YAML, Markdown, CSS and SCSS rows.
No other formatter has any fallback — see `CLAUDE.md` for why.

## `.editorconfig` support

`.editorconfig` is honored when present; tool-native configs (`.prettierrc*`, `.clang-format`, `.ruff.toml`, `pyproject.toml [tool.ruff]`/`[tool.black]`) take precedence over it.

- `shfmt`, `ktlint`, `prettier` read `.editorconfig` natively (run flag-free).
- `ktfmt` is always passed `--enable-editorconfig`.
- For `google-java-format`, `clang-format`, `ruff`, and `black`, a minimal built-in resolver maps core `.editorconfig` properties (`indent_style`, `indent_size`, `max_line_length`, `end_of_line`) to CLI flags — **only** when no tool-native config governs the file. This mapping is intentionally partial (documented properties only).
- **Hard conflicts are skipped, not violated:** if `.editorconfig` declares a style a fixed-style tool cannot produce (`indent_style = tab` for `google-java-format`/`black`; `google-java-format` is also fixed at 100 columns and 2/4-space indent), the file is left untouched rather than reformatted against its own config.
- Go's style is fixed by design (tabs); a conforming `[*.go] indent_style = tab` is honored by construction.

## YAML/JSON: no line-length limit without a project config

`prettier`'s own default `printWidth` (80) reflows long JSON/YAML arrays and
flow mappings onto multiple lines even when the project never asked for an
80-column limit. When formatting `.yaml`/`.yml`/`.json`, `shouldOverridePrintWidth`
leaves `printWidth` unbounded unless the project set a real preference itself — a
`.prettierrc`/`prettier.config.*`/`package.json` `"prettier"` key, or
`.editorconfig`'s `max_line_length` (which `prettier` already honors
natively). Markdown is unaffected: `prettier`'s default `proseWrap` already
never rewraps prose, so there was nothing to fix there.
