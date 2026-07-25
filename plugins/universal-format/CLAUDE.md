# CLAUDE.md — universal-format

Hooks-only plugin: a PostToolUse `Write|Edit` `command` hook silently auto-formats the just-written file for Shell/Java/Kotlin/JS-TS/Python/Go/JSON/YAML/Markdown via each language's standard formatter, backed by a self-contained zero-dep `hooks/format-file.mjs`. No `userConfig` — the hook is always active once the plugin is installed (see "No toggle" below).

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `command`: `command: "${CLAUDE_PLUGIN_ROOT}/hooks/format-file.mjs"`, `timeout: 60`.** Invoked directly (no `node` prefix), no persistent process. **Deliberately no `async`** — the reformat must land, and Claude must see the "re-read before further edits" notice, before its next tool call touches the file; an async hook's output only arrives on the _next_ conversation turn, by which point Claude could already have issued a stale `Edit` against the pre-reformat content. This is the one difference from its sibling `universal-lint`, which IS `async: true` (safe there because linting never mutates the file). No `statusMessage` (silent).
- **Single-hook exception to the repo's `mcp_tool`-preferred default (see `.claude/rules/hooks-mcp-server.md`).** Same rationale as `universal-lint`: exactly one hook, so a persistent MCP stdio server buys nothing here. Unlike `universal-lint`, this plugin gains no extra latency argument from staying synchronous — it simply drops one moving part (the server) while keeping the same timing guarantee it always had.
- **No `bin/mjs-launch.sh` wrapper, no `.mcp.json`.** The script runs directly under `node` (no persistent MCP server).

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` — see `.claude/rules/plugin-userconfig.md`'s exception list. Auto-formatting IS the entire plugin; disabling it is equivalent to uninstalling. Anyone who previously set `auto_format: false` will find that setting silently ignored going forward.

## Runtime behavior (`format_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → extension in the registry → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → file exists → some chain tool on `PATH` (probes cached in-process for the process lifetime). Then: `selectFormatter` walks the language chain in order — a tool missing from `PATH` **or** hitting a hard style conflict (e.g. `.editorconfig` says tabs, `google-java-format` can't do tabs) is skipped, falling through to the next chain entry rather than aborting; only when no chain tool can run does the hook no-op. Invocation resolved per strategy → `spawnSync` (`cwd` = project cwd, 30 s timeout, stdio ignored) → before/after **content diff** decides success (NEVER exit codes: ktlint exits non-zero after a successful format). Changed → `hookSpecificOutput.additionalContext`; unchanged or any error/timeout → `{}`.

Config strategy per tool: `shfmt`/`ktlint`/`prettier` native (run bare, flag-free — shfmt loses ALL EditorConfig handling if given any parser/printer flag); `ktfmt` always `--enable-editorconfig`; `goimports`/`gofmt` fixed style; `google-java-format`/`clang-format`/`ruff`/`black`/`biome` mapped — nearest tool-native config upward → run bare, else `.editorconfig` → mapped flags (hard conflict → skip). `goimports` preferred over `gofmt` (fixes imports); `gofumpt` deliberately excluded (churn on non-opted-in projects). JSON/YAML/Markdown reuse this machinery unchanged: `prettier` (native) covers all three; `biome` (mapped, identical flag mapping to its `jsts` entry) is JSON's second chain entry — Biome's own `.editorconfig` support is opt-in (`formatter.useEditorconfig` defaults `false`), which is exactly why it's `mapped` here, not `native`.

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

## Tests

`test/universal-format/test.bats` (hermetic: stub formatters on an isolated PATH recording argv) + `test/universal-format/*.test.mjs` (`node:test` unit tests for the `.editorconfig` resolver and registry flag mapping). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-format/
npm run test:unit
npm run typecheck
```
