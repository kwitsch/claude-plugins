# CLAUDE.md — universal-lint

mcp-kind hooks plugin: a PostToolUse `Write|Edit` `mcp_tool` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown, backed by a self-contained zero-dep `mcp/server.mjs`. JSON is deliberately excluded (see "JSON: not covered" below).

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `mcp_tool`: `server: "plugin:universal-lint:universal-lint-hooks"`, `tool: "lint_file"`, `timeout: 60`.** The server is registered in `.mcp.json` as the bare key `universal-lint-hooks`; the hook's `server` field MUST use the runtime-namespaced `plugin:universal-lint:universal-lint-hooks` form (a plugin's own server connects under `plugin:<plugin>:<key>`; the bare key resolves to "not connected"). Synchronous (no `async`). No `statusMessage` (silent). mcp-kind is mandated by the repo decision tree: PostToolUse is non-blocking, mid-session, fail-open.

## Runtime behavior (`lint_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → extension in `EXT_MAP` → file exists → some chain tool on `PATH` (probes cached in-process for the server lifetime, checked before the uncached settings-file reads) → `auto_lint` not literal `false`. Then: the first chain tool on `PATH` wins — no per-file style-conflict skip exists here (a linter doesn't need to reproduce exact output the way a formatter does, so there's nothing to conflict with). `buildArgv` appends checkstyle's `-c <resolved config>` and points the two Go entries at the edited file's **directory** rather than the file itself (`go vet`/`golangci-lint` are package-scoped tools). `spawnSync` (cwd = project cwd, 30s timeout, `maxBuffer` 10MB — well above the 1MB default, since a noisy linter's combined output is the payload, not a byproduct — stdout+stderr captured **never ignored**, unlike the formatter sibling, because the findings text itself is the payload). Success is decided by **classification, not a content diff** (the file is never modified): `classifyExit` per tool's documented exit-code contract for five of the six tools; `checkstyle` is the one exception, classified by `classifyCheckstyleOutput` instead, because its exit code counts only `error`-severity violations and the bundled default ruleset (and many real projects) run at `warning` severity — exit-code classification would silently miss real findings there. Issues found → truncated (`MAX_CONTEXT_CHARS = 4000` chars) `additionalContext`; clean, skip (crash/misconfig), or no candidate tool → `{}`.

`eslint`, `markdownlint-cli2`, and `markdownlint` additionally fall back to
`npx --yes <package> ...` when absent from `PATH` (all verified official npm
packages; `npx` itself is assumed present since the plugin's own MCP server
already requires node/npm). `yamllint` gets no npx fallback — it has no npm
package at all (PyPI/pip only). No other chain tool gets an npx fallback —
see `universal-format`'s `CLAUDE.md` for the npm-provenance research; the
same conclusions apply here (`ruff`, `golangci-lint`, `go`, `ktlint`,
`checkstyle` have no safe npm equivalent).

`yamllint` (YAML) and `markdownlint-cli2`/`markdownlint` (Markdown) join the
same 0-clean/1-issues/else-skip `classifyExit` contract as the five tools
above. `yamllint` runs without `--strict`, so warnings-only findings don't
surface — kept consistent with this plugin's existing `eslint` behavior
(warnings don't affect its exit code either).

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

The `npx --yes <pkg>` fallback (taken when the tool itself is absent from
`PATH` but npm-distributed) is now also rtk-routed: `runLintTool` tries
`rtk npx --yes <npmSpec> <argv>` first when `rtk` is on `PATH`, falling
back to the bare `npx --yes …` call on any rtk spawn error/signal — same
fallback-safety contract as the direct branch above. Verified empirically
for both npx-fallback tools in the registry: `eslint` compacts (exit code
preserved); `markdownlint-cli2` is an unfiltered, byte-identical
passthrough (`rtk`'s specialized-filter list covers `eslint`/`tsc`/`prisma`,
not markdownlint) — safe either way since a passthrough changes nothing.

Both the direct-`PATH` and `npx`-fallback tool-finding above, plus the
`rtk` probe itself, run against a `PATH` this server prepends with
`~/.local/bin` and `~/.bun/bin` at module load (mirroring the documented
`bin/mjs-launch.sh` wrapper's own prepend) — defensive hardening for
non-interactive MCP-server spawns that may inherit a stripped-down `PATH`
lacking those directories; not a fix for an observed failure on any
currently-tested environment.

One `userConfig` toggle `auto_lint` (default true, fail-open — only literal `false` disables; linting never modifies or creates files, so the fail-closed exception does not apply).

## JSON: not covered (do not "fix" without reading this)

`.json` is intentionally absent from `EXT_MAP` — not a bug. No standalone,
actively-maintained JSON linter has a clean exit-code contract: `jsonlint`
(npm) has been dead since 2018; its actively-maintained successor
`@prantlf/jsonlint` and `biome lint` both return the same exit code (1) for
"invalid JSON" and "crashed/misconfigured," unlike every tool actually in
this registry. Adding a checkstyle-style output-classifier for a tool whose
own maintainers haven't decomposed this is unforced complexity.
`universal-format` already rejects malformed JSON via its `prettier`/`biome`
chain — format-only coverage is the honest answer for this file type.

## Tests

`test/universal-lint/test.bats` (hermetic: stub linters on an isolated PATH recording argv, temp `$HOME` for toggle tests) + `test/universal-lint/registry.test.mjs` (`node:test` unit tests for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`, `buildArgv`, `truncate`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/
npm run test:unit
npm run typecheck
```
