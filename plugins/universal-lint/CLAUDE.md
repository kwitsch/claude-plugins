# CLAUDE.md — universal-lint

mcp-kind hooks plugin: a PostToolUse `Write|Edit` `mcp_tool` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go, backed by a self-contained zero-dep `mcp/server.mjs`.

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `mcp_tool`: `server: "plugin:universal-lint:universal-lint-hooks"`, `tool: "lint_file"`, `timeout: 60`.** The server is registered in `.mcp.json` as the bare key `universal-lint-hooks`; the hook's `server` field MUST use the runtime-namespaced `plugin:universal-lint:universal-lint-hooks` form (a plugin's own server connects under `plugin:<plugin>:<key>`; the bare key resolves to "not connected"). Synchronous (no `async`). No `statusMessage` (silent). mcp-kind is mandated by the repo decision tree: PostToolUse is non-blocking, mid-session, fail-open.

## Runtime behavior (`lint_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → extension in `EXT_MAP` → file exists → some chain tool on `PATH` (probes cached in-process for the server lifetime, checked before the uncached settings-file reads) → `auto_lint` not literal `false`. Then: the first chain tool on `PATH` wins — no per-file style-conflict skip exists here (a linter doesn't need to reproduce exact output the way a formatter does, so there's nothing to conflict with). `buildArgv` appends checkstyle's `-c <resolved config>` and points the two Go entries at the edited file's **directory** rather than the file itself (`go vet`/`golangci-lint` are package-scoped tools). `spawnSync` (cwd = project cwd, 30s timeout, `maxBuffer` 10MB — well above the 1MB default, since a noisy linter's combined output is the payload, not a byproduct — stdout+stderr captured **never ignored**, unlike the formatter sibling, because the findings text itself is the payload). Success is decided by **classification, not a content diff** (the file is never modified): `classifyExit` per tool's documented exit-code contract for five of the six tools; `checkstyle` is the one exception, classified by `classifyCheckstyleOutput` instead, because its exit code counts only `error`-severity violations and the bundled default ruleset (and many real projects) run at `warning` severity — exit-code classification would silently miss real findings there. Issues found → truncated (`MAX_CONTEXT_CHARS = 4000` chars) `additionalContext`; clean, skip (crash/misconfig), or no candidate tool → `{}`.

`eslint` additionally falls back to `npx --yes eslint ...` when absent from
`PATH` (verified official npm package; `npx` itself is assumed present since
the plugin's own MCP server already requires node/npm). No other chain tool
gets an npx fallback — see `universal-format`'s `CLAUDE.md` for the
npm-provenance research; the same conclusions apply here (`ruff`,
`golangci-lint`, `go`, `ktlint`, `checkstyle` have no safe npm equivalent).

When the resolved tool is on `PATH` **and** `rtk` is also on `PATH`, the tool
runs through `rtk` instead of directly, for token-compacted findings text —
`rtk` passes through the wrapped tool's real exit code unchanged (verified
empirically for `ruff` and `eslint`), so `classifyExit`/
`classifyCheckstyleOutput` need no awareness of it. Which tools `rtk`
actually has a filter for is discovered dynamically per server lifetime via
`rtk rewrite <tool> <tool's static args> "__RTK_PROBE__"` (cached per tool
name) rather than hardcoded, since rtk gains/loses per-tool filters across
releases; `checkstyle` and `ktlint` currently have none and always run
directly. The probe keys off non-empty stdout, not the exact exit code
(`rtk rewrite --help` claims 0/1 for supported/unsupported; observed
behavior on 0.43.0 is 3/1). A spawn error or signal on the `rtk` call itself
falls back to running the tool directly rather than failing open, so a
broken `rtk` install can't silently disable linting.

One `userConfig` toggle `auto_lint` (default true, fail-open — only literal `false` disables; linting never modifies or creates files, so the fail-closed exception does not apply).

## Tests

`test/universal-lint/test.bats` (hermetic: stub linters on an isolated PATH recording argv, temp `$HOME` for toggle tests) + `test/universal-lint/registry.test.mjs` (`node:test` unit tests for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`, `buildArgv`, `truncate`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/
npm run test:unit
npm run typecheck
```
