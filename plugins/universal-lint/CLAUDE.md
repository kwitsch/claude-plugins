# CLAUDE.md — universal-lint

mcp-kind hooks plugin: a PostToolUse `Write|Edit` `mcp_tool` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown, backed by a self-contained zero-dep `mcp/server.mjs`. JSON is deliberately excluded (see "JSON: not covered" below).

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `mcp_tool`: `server: "plugin:universal-lint:universal-lint-hooks"`, `tool: "lint_file"`, `timeout: 60`.** The server is registered in `.mcp.json` as the bare key `universal-lint-hooks`; the hook's `server` field MUST use the runtime-namespaced `plugin:universal-lint:universal-lint-hooks` form (a plugin's own server connects under `plugin:<plugin>:<key>`; the bare key resolves to "not connected"). Synchronous (no `async`). No `statusMessage` (silent). mcp-kind is mandated by the repo decision tree: PostToolUse is non-blocking, mid-session, fail-open.
- **`.mcp.json` invokes `bin/mjs-launch.sh` (not `mcp/server.mjs` directly), with `mcp/server.mjs` as its `args`.** The optional bun-preferred wrapper documented in `.claude/rules/hooks-mcp-server.md` — prefers `bun`, falls back to `node`, errors (exit 1) if neither is on `PATH`. Adopted here for two reasons: it is the natural place to fix the `PATH` non-interactive MCP-server spawns inherit (see below), and it lets this plugin's zero-dep server run under `bun` when available with no code change. The wrapper's own `PATH` line deviates from that rule's canonical template (which prepends `~/.local/bin`/`~/.bun/bin` ahead of the inherited `PATH`): here they are **appended** instead, so a stale/older binary in those user dirs can never shadow a canonical system-installed tool of the same name — decided during this plugin's own rtk/PATH review after a correctness finding on the prepend order; `${PATH:+${PATH}:}` avoids a leading empty `PATH` segment when `PATH` is unset/empty (an empty segment resolves to cwd in `PATH` lookups). `universal-format` carries an identical wrapper for the same reason.

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
behavior on 0.43.0 is 3/1).

Both the direct-`PATH` rtk attempt and the npx-fallback rtk attempt below
share one helper, `tryRtk(argv, spawnOpts)`: a spawn error or signal is
always a failure (falls back to the un-accelerated call, so a broken `rtk`
install can't silently disable linting), and — since a real lint tool
legitimately exits non-zero when it finds issues (`rtk` passing that
through is the success case, not a failure) — a **clean** non-zero exit is
only treated as an `rtk`-internal failure when `stdout` is empty/
whitespace-only. Real findings text always makes `stdout` non-empty, so this
heuristic never misclassifies a genuine lint failure while still catching
the case an untrusted exit-code-only check would miss: `rtk` itself failing
(misconfigured, can't reach its backend/`npx`) with a clean non-zero exit
and no findings text, which would otherwise be shown to the user as if it
were a real lint finding.

The npm-fallback path (taken when the tool itself is absent from `PATH` but
npm-distributed) tries `rtk`'s own discovered verb first — the exact same
`getRtkPrefix`/`tryRtk` mechanism as the on-`PATH` branch above, e.g.
`rtk lint <argv>` for `eslint` — **not** a raw `rtk npx --yes <npmSpec>
<argv>` wrap. This matters: empirically, wrapping `npx --yes <pkg>` with
`rtk` does **not** get `rtk`'s compaction — the `--yes`/`-y` flag defeats
`rtk`'s own package-name detection in its npx intelligent-routing, so
`rtk npx --yes eslint <args>` produces byte-identical, unfiltered output to
bare `npx --yes eslint <args>`. Calling `rtk`'s dedicated verb directly
(`rtk lint <args>`, no npx involved in the argv at all) does compact, and
works even when `eslint` itself is absent from `PATH` — `rtk` resolves it
internally (verified: `rtk lint --version` succeeds and matches `npx eslint
--version`'s own resolved version, with `eslint` absent from `PATH`).
`markdownlint`'s own verb (`rtk markdownlint <argv>`) is a generic,
unfiltered passthrough that requires the literal `markdownlint` binary on
`PATH` — it does not npx-resolve like `eslint`'s `lint` verb does — so a
missing binary makes this attempt fail (empty stdout, non-zero exit),
`tryRtk` correctly recognizes that as an `rtk`-internal failure, and the
code falls through to the bare `npx --yes <npmSpec> <argv>` fallback below.
`markdownlint-cli2` has no `rtk` verb at all (`rtk rewrite markdownlint-cli2
...` exits 1, unsupported) and always falls straight through. This rtk
attempt is bounded by `RTK_NPX_ATTEMPT_TIMEOUT_MS` (5s), not the full
`NPX_SPAWN_TIMEOUT_MS` (55s) the bare npx fallback still gets: reusing the
full budget for both the rtk attempt and its fallback would let worst-case
sequential wall time (~110s) exceed the `PostToolUse` hook's own 60s
ceiling — a correctness bug caught during review. A stalled/slow `rtk` now
simply gets skipped in favor of the guaranteed-correct bare `npx` call,
which still gets its full legitimate cold-install budget; worst case
(5s + 55s = 60s) matches the margin the direct-tool branch above already
runs at (its own rtk attempt and fallback both share `SPAWN_TIMEOUT_MS` =
30s, pre-existing and unchanged by this review).

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

`test/universal-lint/test.bats` (hermetic: stub linters on an isolated PATH recording argv, temp `$HOME` for toggle tests; also covers `bin/mjs-launch.sh`'s bun/node selection, PATH-append order, and error handling in isolation) + `test/universal-lint/registry.test.mjs` (`node:test` unit tests for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`, `buildArgv`, `truncate`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/
npm run test:unit
npm run typecheck
```
