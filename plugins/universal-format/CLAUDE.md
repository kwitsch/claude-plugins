# CLAUDE.md — universal-format

mcp-kind hooks plugin: a PostToolUse `Write|Edit` `mcp_tool` hook silently auto-formats the just-written file for Shell/Java/Kotlin/JS-TS/Python/Go via each language's standard formatter, backed by a self-contained zero-dep `mcp/server.mjs`.

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `mcp_tool`: `server: "plugin:universal-format:universal-format-hooks"`, `tool: "format_file"`, `timeout: 60`.** The server is registered in `.mcp.json` as the bare key `universal-format-hooks`; the hook's `server` field MUST use the runtime-namespaced `plugin:universal-format:universal-format-hooks` form (a plugin's own server connects under `plugin:<plugin>:<key>`; the bare key resolves to "not connected"). Synchronous (no `async`) — the reformat must land before Claude's next tool call touches the file. No `statusMessage` (silent). mcp-kind is mandated by the repo decision tree: PostToolUse is non-blocking, mid-session, fail-open — exactly the `mcp_tool` case; a command hook would re-spawn node and re-probe PATH per event, whereas the long-lived server caches PATH probes.

## Runtime behavior (`format_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → extension in the registry → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → file exists → some chain tool on `PATH` (probes cached in-process for the server lifetime; cheap cached probe runs before the uncached settings reads) → `auto_format` not literal `false` (scopes local>project>user). Then: `selectFormatter` walks the language chain in order — a tool missing from `PATH` **or** hitting a hard style conflict (e.g. `.editorconfig` says tabs, `google-java-format` can't do tabs) is skipped, falling through to the next chain entry rather than aborting; only when no chain tool can run does the hook no-op. Invocation resolved per strategy → `spawnSync` (`cwd` = project cwd, 30 s timeout, stdio ignored) → before/after **content diff** decides success (NEVER exit codes: ktlint exits non-zero after a successful format). Changed → `hookSpecificOutput.additionalContext`; unchanged or any error/timeout → `{}`.

Config strategy per tool: `shfmt`/`ktlint`/`prettier` native (run bare, flag-free — shfmt loses ALL EditorConfig handling if given any parser/printer flag); `ktfmt` always `--enable-editorconfig`; `goimports`/`gofmt` fixed style; `google-java-format`/`clang-format`/`ruff`/`black`/`biome` mapped — nearest tool-native config upward → run bare, else `.editorconfig` → mapped flags (hard conflict → skip). `goimports` preferred over `gofmt` (fixes imports); `gofumpt` deliberately excluded (churn on non-opted-in projects).

One `userConfig` toggle `auto_format` (default true, fail-open — only literal `false` disables; formatting modifies existing files but creates none, so the fail-closed exception does not apply).

## Tests

`test/universal-format/test.bats` (hermetic: stub formatters on an isolated PATH recording argv, temp `$HOME` for toggle tests) + `test/universal-format/*.test.mjs` (`node:test` unit tests for the `.editorconfig` resolver and registry flag mapping). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-format/
npm run test:unit
npm run typecheck
```
