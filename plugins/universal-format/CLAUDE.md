# CLAUDE.md — universal-format

Hooks-only plugin: a PostToolUse `Write|Edit` `command` hook silently auto-formats the just-written file for Shell/Java/Kotlin/JS-TS/Python/Go/JSON/YAML/Markdown/CSS/SCSS/PHP via each language's standard formatter, backed by a self-contained zero-dep `hooks/format-file.mjs`. No `userConfig` — the hook is always active once the plugin is installed (see "No toggle" below).

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `command`: `command: "${CLAUDE_PLUGIN_ROOT}/hooks/format-file.mjs"`, `timeout: 60`.** Invoked directly (no `node` prefix), no persistent process. **Deliberately no `async`** — the reformat must land, and Claude must see the "re-read before further edits" notice, before its next tool call touches the file; an async hook's output only arrives on the _next_ conversation turn, by which point Claude could already have issued a stale `Edit` against the pre-reformat content. This is the one difference from its sibling `universal-lint`, which IS `async: true` (safe there because linting never mutates the file). No `statusMessage` (silent).
- **Single-hook exception to the repo's `mcp_tool`-preferred default (see `.claude/rules/hooks-mcp-server.md`).** Same rationale as `universal-lint`: exactly one hook, so a persistent MCP stdio server buys nothing here. Unlike `universal-lint`, this plugin gains no extra latency argument from staying synchronous — it simply drops one moving part (the server) while keeping the same timing guarantee it always had.
- **No `bin/mjs-launch.sh` wrapper, no `.mcp.json`.** The script runs directly under `node` (no persistent MCP server).

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` — see `.claude/rules/plugin-userconfig.md`'s exception list. Auto-formatting IS the entire plugin; disabling it is equivalent to uninstalling. Anyone who previously set `auto_format: false` will find that setting silently ignored going forward.

## Runtime behavior (`format_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → extension in the registry → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → file exists → some chain tool on `PATH` (probes cached in-process for the process lifetime). Then: `selectFormatter` walks the language chain in order — a tool missing from `PATH` **or** hitting a hard style conflict (e.g. `.editorconfig` says tabs, `google-java-format` can't do tabs) is skipped, falling through to the next chain entry rather than aborting; only when no chain tool can run does the hook no-op. Invocation resolved per strategy → `spawnSync` (`cwd` = project cwd, 30 s timeout, stdio ignored) → before/after **content diff** decides success (NEVER exit codes: ktlint exits non-zero after a successful format). Changed → `hookSpecificOutput.additionalContext`; unchanged or any error/timeout → `{}`.

Config strategy per tool: `shfmt`/`ktlint`/`prettier` native (run bare, flag-free — shfmt loses ALL EditorConfig handling if given any parser/printer flag); `ktfmt` always `--enable-editorconfig`; `goimports`/`gofmt` fixed style; `google-java-format`/`clang-format`/`ruff`/`black`/`biome` mapped — nearest tool-native config upward → run bare, else `.editorconfig` → mapped flags (hard conflict → skip). `goimports` preferred over `gofmt` (fixes imports); `gofumpt` deliberately excluded (churn on non-opted-in projects). JSON/YAML/Markdown reuse this machinery largely unchanged: `prettier` (native) covers all three, with one addition — JSON and YAML's `prettier` entry (`PRETTIER_LINE_LENGTH_GUARDED`) also carries the `guardPrintWidth` line-length guard described below; Markdown's stays plain `PRETTIER_NATIVE`. `biome` (mapped, identical flag mapping to its `jsts` entry) is JSON's second chain entry — Biome's own `.editorconfig` support is opt-in (`formatter.useEditorconfig` defaults `false`), which is exactly why it's `mapped` here, not `native`. `css` reuses this exact machinery — `prettier` (native) plus `biome` (mapped) — with one wrinkle `json` doesn't share: Biome's CSS formatter/linter were only "stable and enabled by default" as of Biome v1.9 (verified against Biome's own changelog/blog); before that, CSS formatting is opt-in via `biome.json`. `selectFormatter`'s first pass picks whichever chain tool is on `PATH` without probing whether it will actually change anything, so a pre-1.9 `biome` on `PATH` with no `biome.json` CSS opt-in and no `prettier` gets "selected," runs, makes no edit, and the hook silently no-ops — no fallback to `prettier`'s `npx` path, no notice. Known, accepted limitation (verified 2026-07-28): a real fix needs Biome-version/config detection, which is new machinery beyond a per-language registry addition. `scss` gets `prettier` only: Biome's CSS parser explicitly does not support SCSS syntax (Biome v1.9 release notes: "Biome supports standard CSS syntax but not dialects like SCSS"), so `biome` is deliberately absent from the `scss` chain — a project with no `prettier` on `PATH`/npx simply gets no auto-format for `.scss`, the same silent no-op as any other language with no available formatter.

## YAML/JSON line-length guard (do not "fix" without reading this)

`prettier`'s own default `printWidth` (80) drives real wrapping decisions —
verified empirically: a JSON/YAML array or flow mapping longer than 80
columns gets broken onto multiple lines by default, purely because of this
default, in a project that never asked for an 80-column limit. Unlike the
`google-java-format`/`clang-format`/`ruff`/`black`/`biome` tools above,
`prettier`'s CLI auto-discovers its **own** project config when invoked bare
("native" strategy) — so a project with a real `.prettierrc`/`printWidth`
setting was always already respected. This guard only changes the _absent_
case: previously, no project config meant prettier's built-in 80-column
default applied unconditionally; now it means no line-length limit at all.

- `guardPrintWidthArgv` (used only by `json`/`yaml`'s prettier entry,
  `PRETTIER_LINE_LENGTH_GUARDED` — `markdown`/`css`/`scss`/`jsts` keep plain
  `PRETTIER_NATIVE`, untouched) checks two things in order: (1)
  `hasPrettierProjectConfig`, existence-only over prettier's own bundled
  `CONFIG_FILES` list (`.prettierrc*`/`prettier.config.*`) plus a top-level
  `"prettier"` key in `package.json` (parsed as JSON, `Object.hasOwn` on the
  top-level key only — a `"prettier"` entry under `devDependencies` does
  **not** count) or `package.yaml` (pnpm's `package.json` equivalent; existence-
  checked via an anchored top-level-only regex, since this file has no bundled
  YAML parser) — verified against prettier 3.9.6's own source
  (`loadConfigFromPackageJson`/`loadConfigFromPackageYaml`); (2) if that finds
  nothing, `resolveEditorconfig` (the same resolver `ruff`/`black`/`biome`
  already use) — prettier already reads `.editorconfig`'s `max_line_length`
  natively when run bare (verified empirically), so a project that set it
  there is also left alone. One wrinkle: `normalizeProps` drops an explicit
  `max_line_length = off` entirely (treated the same as "not set" — see its
  own comment), so a project that deliberately turned the limit _off_ via
  `.editorconfig` still falls through to `--print-width` below. Same net
  effect either way (no line-length limit), so this isn't a behavior bug —
  just worth knowing so "off" isn't mistaken for a case this guard skips.
  Only when **both** checks come up empty (or resolve to "off") does
  `--print-width 99999` get appended — a value large enough that no real line
  ever triggers wrapping, without passing a literal `Infinity` (prettier's CLI
  argument parser rejects that).
- **Unbounded walk, not `cwd`-bounded:** `hasPrettierProjectConfig` walks from
  the edited file's own directory all the way to the filesystem root, not
  just up to `cwd` — verified against prettier 3.9.6's own source: its config
  searcher's `stopDirectory` hook always returns `undefined`, so its real
  default search has no such bound either. Stopping at `cwd` (the way
  `findNativeConfig`/`resolveEditorconfig` do, correctly, for `ruff`/`black`/
  `biome`/`.editorconfig`) would risk misdetecting "absent" for a real
  prettier config living above the project root (a workspace/monorepo case)
  — silently overriding a config this plugin never saw, the opposite of what
  this guard exists to prevent.
- **Markdown is deliberately untouched.** `prettier`'s default `proseWrap` is
  `"preserve"` — verified empirically that prettier does **not** rewrap long
  prose lines by default, so there was no default-line-length problem to fix
  for `.md` in the first place. Passing `--print-width` here would do nothing
  to prose, but does perturb _other_ formatting decisions inside a Markdown
  file (verified empirically: it changes how a fenced ` ```json ` code block
  gets wrapped) — an unrelated side effect this guard has no reason to cause.
- `.scss`'s own printWidth default is also unguarded, same as `css`/`markdown`
  — only `json`/`yaml` were reported as having this problem.

`prettier` and `biome` additionally fall back to `npx --yes <package> ...`
when absent from `PATH` (verified-official npm packages: `prettier`,
`@biomejs/biome`; `npx` itself is assumed present since the plugin's own hook
script already requires node/npm — no separate onboarding step). No other
chain tool gets an npx fallback: `npm view` shows their same-named npm
packages are either non-existent, unrelated projects (name collisions), or
unofficial/unverifiable wrappers with no repo and near-zero downloads —
adding a fallback for those would silently run the wrong or unvetted code.
This also extends the existing first-available-wins chain order to npx: a
project with only `biome.json` (no prettier config, neither on `PATH`) still
gets `npx prettier` when npx is present, matching the pre-existing
PATH-only rule that `prettier` already wins over `biome` whenever both are
equally available.

`php` reuses this exact machinery with the simplest config strategy in this registry: both `php-cs-fixer` (chain[0]) and `phpcbf` (chain[1], PHP_CodeSniffer's fixer) are `native` (always bare) — no `.editorconfig` mapping, no `MAPPERS` entry. Each tool auto-discovers its own project config and falls back to a built-in PSR-12-equivalent default entirely on its own: `php-cs-fixer`'s own docs state that a bare `fix` with no `--config`/`--rules` already defaults to `@PSR12` when no `.php-cs-fixer.php`/`.dist.php` is found; PHP_CodeSniffer's own docs state the same PSR-12 default plus an upward-walking `phpcs.xml`/`.phpcs.xml`(`.dist`) discovery. Since format success here is always judged by content diff (never exit code), neither tool's exit-code contract matters. `phpcbf`'s realistic hit rate as a fallback leans on a global/system install (PHP_CodeSniffer is commonly distro-packaged, e.g. Debian/Ubuntu's `php-codesniffer` — unlike `php-cs-fixer`, which isn't) rather than the project-local `vendor/bin/` Composer install this plugin doesn't discover (known limitation, confirmed with the user at this feature's design stage): unlike `universal-lint`'s own `tsc` special case (`node_modules/.bin/tsc`), no `vendor/bin/<tool>` discovery exists for any tool in this file, PHP included — most real PHP projects install these as local Composer dev-dependencies rather than globally, so this chain will silently no-op on such projects until a global/PATH install is also present. Neither `php-cs-fixer` nor `phpcbf` gets an `npmSpec`: both are Composer-distributed, not npm-distributed.

## Tests

`test/universal-format/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `kotlin.bats`, `java.bats`,
`python.bats`, `jsts.bats`, `json.bats`, `yaml.bats`, `markdown.bats`,
`css.bats`, `php.bats`), mirroring `test/coding-toolbox/`'s split. `test_helper.bash`
holds what's shared across files (`common_setup`, `rg_or_grep`,
`make_stub`, `rec_stub`, `format_file_call`). Hermetic: stub formatters on
an isolated PATH recording argv. Plus `test/universal-format/*.test.mjs`
(`node:test` unit tests for the `.editorconfig` resolver and registry flag
mapping). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-format/
npm run test:unit
npm run typecheck
```
