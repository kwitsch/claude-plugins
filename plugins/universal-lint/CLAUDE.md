# CLAUDE.md — universal-lint

Hooks-only plugin: a PostToolUse `Write|Edit` `command` hook runs the just-written file's standard linter (check-only, never `--fix`/`--format`/`--write`) for Shell/Java/Kotlin/JS-TS/Python/Go/YAML/Markdown/CSS/SCSS, backed by a self-contained zero-dep `hooks/lint-file.mjs`. TypeScript files (`.ts`/`.tsx`/`.mts`/`.cts`) additionally get a whole-project `tsc --noEmit` type-check (see "TypeScript type-checking (`tsc`)" below). JSON is deliberately excluded (see "JSON: not covered" below). No `userConfig` — the hook is always active once the plugin is installed (see "No toggle" below).

## Hook design (do not "fix" without reading this)

- **PostToolUse `Write|Edit` → `command`: `command: "${CLAUDE_PLUGIN_ROOT}/hooks/lint-file.mjs"`, `timeout: 90`, `async: true`.** Invoked directly (no `node` prefix — repo convention for `.mjs` command hooks) once per Write/Edit, no persistent process. No `statusMessage` (silent). (Raised from 60 to 90 for `tsc` — see "TypeScript type-checking (`tsc`)" below.)
- **Single-hook exception to the repo's `mcp_tool`-preferred default (see `.claude/rules/hooks-mcp-server.md`).** This plugin backs exactly one hook, so a persistent MCP stdio server (handshake, `tools/list`/`tools/call` framing) buys nothing a plain per-event script doesn't already give for free. `async: true` removes the one argument that would otherwise favor a server here (avoiding per-event process-spawn latency): the agentic loop doesn't wait for this hook either way. Safe specifically because linting never mutates the file — findings arriving as context one turn later (async's documented delivery timing) has no correctness cost. Compare `universal-format`, which stays synchronous for exactly the opposite reason.
- **No `bin/mjs-launch.sh` wrapper, no `.mcp.json`.** Removed along with the MCP server (2026-07-24) — a direct `.mjs` command hook needs neither; this also means the script always runs under `node`, never `bun`, matching the repo's stated default for direct-invoked `.mjs` hooks.

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` (2026-07-24, deliberate — see `.claude/rules/plugin-userconfig.md`'s exception list). Read-only linting IS the entire plugin; there is no other feature to gate, so disabling it is equivalent to uninstalling the plugin. Anyone who previously set `auto_lint: false` will find that setting silently ignored going forward — the only way to turn this off now is uninstalling the plugin.

## Runtime behavior (`lint_file`)

Guards, each failing to `{}` silently: `tool_response.success !== false` → resolved path inside `cwd` and not under `node_modules/`/`vendor/`/`.git/` → extension in `EXT_MAP` → file exists → some chain tool on `PATH` (probes cached in-process for the process lifetime). Then: the first chain tool on `PATH` wins — no per-file style-conflict skip exists here (a linter doesn't need to reproduce exact output the way a formatter does, so there's nothing to conflict with). `buildArgv` appends checkstyle's `-c <resolved config>` and points the two Go entries at the edited file's **directory** rather than the file itself (`go vet`/`golangci-lint` are package-scoped tools). `spawnSync` (cwd = project cwd, 30s timeout, `maxBuffer` 10MB — well above the 1MB default, since a noisy linter's combined output is the payload, not a byproduct — stdout+stderr captured **never ignored**, unlike the formatter sibling, because the findings text itself is the payload). Success is decided by **classification, not a content diff** (the file is never modified): `classifyExit` per tool's documented exit-code contract for five of the six tools; `checkstyle` is the one exception, classified by `classifyCheckstyleOutput` instead, because its exit code counts only `error`-severity violations and the bundled default ruleset (and many real projects) run at `warning` severity — exit-code classification would silently miss real findings there. Issues found → truncated (`MAX_CONTEXT_CHARS = 4000` chars) `additionalContext`; clean, skip (crash/misconfig), or no candidate tool → `{}`.

`eslint`, `markdownlint-cli2`, and `markdownlint` additionally fall back to
`npx --yes <package> ...` when absent from `PATH` (all verified official npm
packages; `npx` itself is assumed present since the plugin's own MCP server
already requires node/npm). `yamllint` gets no npx fallback — it has no npm
package at all (PyPI/pip only). No other chain tool gets an npx fallback —
see `universal-format`'s `CLAUDE.md` for the npm-provenance research; the
same conclusions apply here (`ruff`, `golangci-lint`, `go`, `ktlint`,
`checkstyle` have no safe npm equivalent).

`stylelint` (CSS/SCSS) joins the eslint/markdownlint npx-fallback group (its
npm package name matches its single bin, same safe shape as `eslint`) but
does **not** share the other eight tools' 0-clean/1-issues/else-skip exit
contract: `0` clean, `2` a real lint problem, everything else (`1` fatal
error, `64` invalid CLI usage, `78` invalid config) `skip` — verified
against stylelint's own CLI docs (stylelint.io/user-guide/usage/cli).

Known, accepted limitation for `.scss` (pre-existing, not new to the `.css`
addition — verified empirically 2026-07-28): `args: []` passes no
`customSyntax`, so stylelint parses `.scss` with its default CSS-only parser.
stylelint removed automatic by-extension syntax inferral in v14 — SCSS needs
an explicit `customSyntax` (e.g. `postcss-scss`, typically pulled in via
`stylelint-config-standard-scss`), which is not bundled with stylelint and
not something this plugin can add without a new dependency the target
project may not have. In a project with a stylelint config but no SCSS-aware
`customSyntax`, ordinary SCSS constructs (`//` comments, `$variables`,
`&`-nesting, `#{...}` interpolation) can surface as bogus `CssSyntaxError`
"issues" rather than real style violations. `.css` files are unaffected —
plain CSS parses correctly under the default parser.

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

## TypeScript type-checking (`tsc`)

`.ts`/`.tsx`/`.mts`/`.cts` files get a **second, independent** check beyond
the existing `eslint` chain: a whole-project `tsc --noEmit` type-check. This
is not a chain alternative (plain `.js`/`.jsx`/`.mjs`/`.cjs` never trigger
it) — both `eslint` and `tsc` can report findings on the same edit, and both
are surfaced together in one `additionalContext` (each finding's text is
truncated independently at `MAX_CONTEXT_CHARS`, preserving the exact
single-finding output format for every other language).

tsc has no single-file mode with project context (confirmed: "When input
files are specified on the command line, tsconfig.json files are ignored"),
so the check necessarily runs the whole project via `-p <nearest
tsconfig.json>`, found by walking up from the edited file to `cwd`
(`resolveTsconfig`, same walk shape as `resolveCheckstyleConfig`). A
**solution-style** tsconfig (`"references"` present, `"include"` absent, and
`"files"` either absent or an empty array — `"files": []` is the TS
handbook's own documented way to author one, so an empty array must not
disqualify it) is explicitly detected and skipped
(`looksLikeSolutionStyleTsconfig`) — confirmed empirically that such a
tsconfig compiles/checks nothing and exits `0` even with a real type error
in the referenced project, which would otherwise silently misreport
"clean." The detection is an existence/pattern-only regex over
comment-stripped text (`stripJsonComments`), not a full JSON/JSONC parse —
tsconfig permits `//` and `/* */` comments and trailing commas, and real
projects routinely put a comment like `// see project references` next to a
key, which would otherwise false-positive-match the same regex. Deliberately
unanchored (no line-start requirement) so it matches equally in compact
single-line and pretty-printed JSON. A string _value_ containing the exact
literal substring `"references":` would still false-match — accepted
residual risk, since tsconfig.json's fixed schema has no free-text fields
where that's realistic, unlike comments.

To keep repeat full-project checks fast, the run adds `--incremental
--tsBuildInfoFile <cache path>`, where the cache path lives under
`${CLAUDE_PLUGIN_DATA}` (persistent, exported to hook processes — falls
back to the OS temp dir, never `.`/cwd, on the unset case, so this plugin's
"never writes into the repo" property holds either way), named by hashing
the tsconfig's realpath (`tsBuildInfoPathFor`, mirroring
`memory-enhancement`'s `flagPathFor` hash-suffix idiom). Verified
empirically against this repo's own `tsconfig.json`: a cold run took 0.70s,
the cached rerun 0.29s.

`classifyExit`'s `"tsc"` case shares stylelint's 0-clean/2-issues/else-skip
contract — verified **empirically** (tsc v6.0.3), not from documentation: a
real type or syntax error under `--noEmit` exits `2`; an invalid project
path (nonexistent tsconfig) exits `1` — the _opposite_ of what the
compiler's documented `ExitStatus` enum (`Success=0`,
`DiagnosticsPresent_OutputsSkipped=1`, `_OutputsGenerated=2`) suggested.
Trust the live behavior, not the enum — re-verify if the installed `tsc`
major version changes materially and findings stop surfacing.

Discovery: `tsc` on `PATH` first (runs through the same `runLintTool`
rtk-compaction attempt every other chain tool gets, keyed off the static
probe args `--noEmit --incremental`), else `<cwd>/node_modules/.bin/tsc`
(the common case — most projects only have `typescript` as a local
devDependency) invoked directly with no rtk attempt (rtk's own tool
database matches by well-known command name, not arbitrary absolute paths).
**No `npx` fallback** — the `typescript` npm package ships two bins (`tsc`,
`tsserver`) with neither matching the package name, so the existing
`npx --yes <npmSpec> <argv>` single-positional idiom (verified correct only
when package/bin name match or the package has exactly one bin) isn't
guaranteed to resolve `tsc` correctly.

`TSC_SPAWN_TIMEOUT_MS` (45s) is its own budget — smaller than
`NPX_SPAWN_TIMEOUT_MS` (55s) so a stale async finding doesn't arrive too
late to be useful, larger than `SPAWN_TIMEOUT_MS` (30s) since a
full-project incremental check is slower than a single-file/directory
tool. The hook's own `timeout` (`hooks.json`) is raised from 60 to 90 to
fit the common case (chain-tool up to 30s + tsc's 45s = 75s, 15s margin).
That "30s"/"45s" framing is optimistic, not a hard ceiling: both phases
reuse `runLintTool`, whose on-`PATH` branch tries `rtk` first and, if that
attempt itself times out, falls through to a second direct spawn of the
same tool at the same timeout — so a tool `rtk` claims to support but is
slow/hangs on can cost up to 2x its nominal budget (chain-tool up to 60s;
tsc's own on-`PATH` run up to 90s), not just the documented cold-npx-install
path. This is pre-existing `runLintTool` behavior (predates this plugin's
`tsc`/`stylelint` additions, and applies to every chain tool, not something
specific to them) — reworking it is out of this scope. Accepted: whenever
the combined wall time exceeds the hook's 90s ceiling — the documented
cold-npx case, or this rtk-doubling case, or both compounding — the hook is
simply killed and that turn's async finding(s) are silently lost
(fail-open, not wrong: no incorrect result is ever surfaced), and the next
edit's tsc run hits a warm cache regardless.

Two overlapping hook processes editing `.ts` files in the same project in
quick succession hash to the same `--tsBuildInfoFile` path and could
interleave writes — accepted: the buildinfo is a performance cache, not a
correctness input, so a corrupted file either makes tsc silently fall back
to a full rebuild (self-healing) or exit non-`0`/`2` (falls into the "skip"
bucket — a missed finding that turn, not a wrong one).

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

`test/universal-lint/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `checkstyle.bats`,
`truncation.bats`, `npx-fallback.bats`, `rtk.bats`, `yaml.bats`,
`markdown.bats`, `stylelint.bats`, `tsc.bats`), mirroring
`test/coding-toolbox/`'s split. `test_helper.bash` holds what's shared
across files (`common_setup`, `rg_or_grep`, `make_stub`, `rec_stub`,
`lint_file_call`); `rtk_stub` stays local to `rtk.bats`, the only file that
uses it. Hermetic: stub linters on an isolated PATH recording argv, piping
a PostToolUse hook-JSON payload into a fresh `lint-file.mjs` invocation per
test. Plus `test/universal-lint/registry.test.mjs` (`node:test` unit tests
for `classifyExit`, `classifyCheckstyleOutput`, `resolveCheckstyleConfig`,
`buildArgv`, `truncate`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/universal-lint/
npm run test:unit
npm run typecheck
```
