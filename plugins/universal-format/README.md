# universal-format

Silently auto-formats source files around Write/Edit — Prettier languages before the write with the Prettier (and the Java, PHP and Shell plugins bundled next to it) the plugin ships inside its own MCP server, the three remaining languages after it via their own CLI — honoring `.editorconfig`, `.prettierignore` and tool-native configs, and doing nothing when no formatter can be found.

## Install

```
/plugin install universal-format@kwitsch-plugins
```

## What it does

Two `Write|Edit` hooks on a self-contained plugin-local MCP server, plus two more that react to
your working directory changing — a `CwdChanged` hook that only refreshes that server's cached
view of your `.prettierignore`, and (for background-job sessions using
`EnterWorktree`, which `CwdChanged` doesn't reliably fire for) a `PostToolUse:EnterWorktree` hook
that does the same cache refresh plus remembers the worktree path it was given as the cwd the
other two hooks should resolve files against for the rest of that session. Neither ever formats
anything.

**Prettier languages** (JS/TS, JSON, YAML, Markdown, CSS, SCSS, LESS, HTML, Vue, GraphQL, Shell,
Java, PHP) are formatted **before** the write, in-process, by the Prettier this plugin ships inside
its own MCP server — together with the three community plugins bundled next to it
(`prettier-plugin-java`, `@prettier/plugin-php`, `prettier-plugin-sh`) and their three `.wasm`
sidecars. There is no version lookup and no install step: one bundled copy, always used, with no
network access.

**All other languages** (Kotlin, Python, Go, Rust) are formatted after the write via each tool's CLI.

Your project's Prettier **configuration** is still honored in full — `.prettierrc*`,
`prettier.config.*`, a top-level `"prettier"` key in `package.json`/`package.yaml`,
`.editorconfig`, and `.prettierignore`.

**`.gitignore` is deliberately not consulted.** Prettier's own CLI defaults `--ignore-path` to
`[.gitignore, .prettierignore]`; this plugin only ever reads the `.prettierignore` at the file's
own project root. A file that is gitignored but not prettierignored (a `dist/` bundle, generated
sources) **is** formatted — add it to `.prettierignore` if it should not be.

**"The file's own project root" is one directory per file, chosen in this order:** your session's
working directory when the file is inside it, otherwise the file's own Git root, otherwise — when
the file has no Git root either — the file's own directory. That same directory controls every
other project-scoped lookup too: `.prettierrc*`/`.editorconfig` discovery and `plugins:` resolution
below.

Two consequences worth knowing:

- **The bundled Prettier version is used even when your project pins a different one.** Formatting
  differences between Prettier minors are real, so your own `prettier --check` may disagree with
  what this plugin wrote. Exclude the paths via `.prettierignore` if that matters.
- **A `plugins:` entry your project's config names must be resolvable from that same directory;**
  if one cannot be resolved, the file is left **unformatted** rather than formatted without the
  plugin you asked for.

An unavailable formatter, any failure, an unsupported extension, a file under
`node_modules/`/`vendor/`/`.git/`, or a path excluded by the project's own `.prettierignore` is a
**silent no-op** — the hooks never block or degrade the session. Files outside your working
directory are no longer skipped: they are formatted against **their own** project's configuration
(its `.prettierrc*`, `.editorconfig` and `.prettierignore`). When formatting changed the file, the
hook returns a one-line note telling Claude to re-read it before further string-based edits, and
that the reformat is intentional and exempt from "surgical/minimal-diff" change-scope rules.

This plugin is always active once installed — there is no toggle, and there is no per-language
switch. For Kotlin, Python, Go and Rust, not installing the tool is the opt-out. **Prettier is the
exception:** it is bundled — Java, PHP and Shell included — so removing Prettier from your project
does not opt out of Prettier formatting; exclude the paths via `.prettierignore` instead.

## Supported formatters

| Language | Extensions                                            | Formatter chain                                   |
| -------- | ----------------------------------------------------- | ------------------------------------------------- |
| Shell    | `.sh` `.bash`                                         | bundled `prettier` (in-process, before the write) |
| Java     | `.java`                                               | bundled `prettier` (in-process, before the write) |
| Kotlin   | `.kt` `.kts`                                          | `ktlint` → `ktfmt`                                |
| JS/TS    | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | bundled `prettier` (in-process, before the write) |
| Python   | `.py` `.pyi`                                          | `ruff` → `black`                                  |
| Go       | `.go`                                                 | `goimports` → `gofmt`                             |
| Rust     | `.rs`                                                 | `rustfmt`                                         |
| JSON     | `.json`                                               | bundled `prettier` (in-process, before the write) |
| YAML     | `.yaml` `.yml`                                        | bundled `prettier` (in-process, before the write) |
| Markdown | `.md`                                                 | bundled `prettier` (in-process, before the write) |
| CSS      | `.css`                                                | bundled `prettier` (in-process, before the write) |
| SCSS     | `.scss`                                               | bundled `prettier` (in-process, before the write) |
| LESS     | `.less`                                               | bundled `prettier` (in-process, before the write) |
| HTML     | `.html` `.htm`                                        | bundled `prettier` (in-process, before the write) |
| Vue      | `.vue`                                                | bundled `prettier` (in-process, before the write) |
| GraphQL  | `.graphql` `.gql`                                     | bundled `prettier` (in-process, before the write) |
| PHP      | `.php`                                                | bundled `prettier` (in-process, before the write) |

`prettier` is the copy bundled into the plugin's own MCP server, together with the
`prettier-plugin-java`, `@prettier/plugin-php` and `prettier-plugin-sh` plugins bundled beside it
— never looked up on `PATH`, never installed, never fetched. This covers all thirteen bundled
`prettier` rows above. No other formatter has any fallback — see `CLAUDE.md` for why.

## `.editorconfig` support

`.editorconfig` is honored when present; tool-native configs (`.prettierrc*`, `.ruff.toml`, `pyproject.toml [tool.ruff]`/`[tool.black]`) take precedence over it.

- `prettier` and `ktlint` read `.editorconfig` natively (run flag-free). For the thirteen bundled `prettier` languages that is the whole mechanism — `indent_style`, `indent_size` and `max_line_length` included, Shell, Java and PHP with them.
- `ktfmt` is always passed `--enable-editorconfig`.
- For `ruff` and `black`, a minimal built-in resolver maps core `.editorconfig` properties (`indent_style`, `indent_size`, `max_line_length`, `end_of_line`) to CLI flags — **only** when no tool-native config governs the file. This mapping is intentionally partial (documented properties only).
- For `rustfmt`, the same resolver maps `max_line_length`/`indent_style`/`indent_size` to `--config max_width`/`--config hard_tabs`/`--config tab_spaces` — **only** when no `rustfmt.toml`/`.rustfmt.toml` governs the file. `rustfmt` honors every tab/space combination, so there is no hard-conflict skip.
- **Hard conflicts are skipped, not violated:** `black` is hard-fixed at 4-space indentation, so an `.editorconfig` declaring `indent_style = tab` leaves the Python file untouched rather than reformatted against its own config.
- Go's style is fixed by design (tabs); a conforming `[*.go] indent_style = tab` is honored by construction.

Two notes on the languages that moved to the bundled `prettier`:

- `.html`/`.htm` is formatted by `prettier`'s own HTML printer, and `*.component.html` automatically picks up its `angular` parser. Server-side template dialects that merely look like HTML (Twig, Blade, Go templates, ERB) are not HTML — exclude them via `.prettierignore`.
- `.prettierignore` now suppresses Shell, Java and PHP formatting too. The old post-write CLI chains never consulted that file, so a `.sh` file listed in `.prettierignore` used to be reformatted anyway and no longer is. Without a `max_line_length`/`printWidth` preference these languages get `prettier`'s 80-column default.

## YAML/JSON: no line-length limit without a project config

`prettier`'s own default `printWidth` (80) reflows long JSON/YAML arrays and
flow mappings onto multiple lines even when the project never asked for an
80-column limit. When formatting `.yaml`/`.yml`/`.json`, `shouldOverridePrintWidth`
leaves `printWidth` unbounded unless the project set a real preference itself — a
`.prettierrc`/`prettier.config.*`/`package.json` `"prettier"` key, or
`.editorconfig`'s `max_line_length` (which `prettier` already honors
natively). Markdown is unaffected: `prettier`'s default `proseWrap` already
never rewraps prose, so there was nothing to fix there.
