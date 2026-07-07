# CLAUDE.md — universal-lint

mcp-kind hooks plugin: a PostToolUse `Write|Edit` `mcp_tool` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go, backed by a self-contained zero-dep `mcp/server.mjs`.

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `mcp_tool`: `server: "plugin:universal-lint:universal-lint-hooks"`, `tool: "lint_file"`, `timeout: 60`.** The server is registered in `.mcp.json` as the bare key `universal-lint-hooks`; the hook's `server` field MUST use the runtime-namespaced `plugin:universal-lint:universal-lint-hooks` form (a plugin's own server connects under `plugin:<plugin>:<key>`; the bare key resolves to "not connected"). Synchronous (no `async`). No `statusMessage` (silent). mcp-kind is mandated by the repo decision tree: PostToolUse is non-blocking, mid-session, fail-open.

## Runtime behavior (`lint_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → extension in `EXT_MAP` → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → file exists → some chain tool on `PATH` (probes cached in-process for the server lifetime, checked before the uncached settings-file reads) → `auto_lint` not literal `false`. Then: the first chain tool on `PATH` wins — no per-file style-conflict skip exists here (a linter doesn't need to reproduce exact output the way a formatter does, so there's nothing to conflict with). `buildArgv` appends checkstyle's `-c <resolved config>` and points the two Go entries at the edited file's **directory** rather than the file itself (`go vet`/`golangci-lint` are package-scoped tools). `spawnSync` (cwd = project cwd, 30s timeout, stdout+stderr captured — **never ignored**, unlike the formatter sibling, because the findings text itself is the payload). Success is decided by **classification, not a content diff** (the file is never modified): `classifyExit` per tool's documented exit-code contract for five of the six tools; `checkstyle` is the one exception, classified by `classifyCheckstyleOutput` instead, because its exit code counts only `error`-severity violations and the bundled default ruleset (and many real projects) run at `warning` severity — exit-code classification would silently miss real findings there. Issues found → truncated (`MAX_CONTEXT_CHARS = 4000` chars) `additionalContext`; clean, skip (crash/misconfig), or no candidate tool → `{}`.

One `userConfig` toggle `auto_lint` (default true, fail-open — only literal `false` disables; linting never modifies or creates files, so the fail-closed exception does not apply).

## Tests

`test/universal-lint/test.bats` (hermetic: stub linters on an isolated PATH recording argv, temp `$HOME` for toggle tests) + `test/universal-lint/registry.test.mjs` (`node:test` unit tests for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`, `buildArgv`, `truncate`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/
npm run test:unit
npm run typecheck
```
