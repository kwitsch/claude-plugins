# CLAUDE.md — inline-headroom

Mods-API plugin (the repo's first): one TypeScript function-hooks module, no
skills/agents/command hooks. Three levers, each behind a boolean `userConfig`
toggle (`effort_routing_enabled`, `cache_aligner_enabled`,
`smart_crusher_enabled`), plus `subagent_effort_routing_enabled`, which extends
effort routing to subagent and Workflow-agent steps and is active only while
`effort_routing_enabled` is on (all four `default: true`, only literal `false`
disables), plus the `/headroom` stats command and the SmartCrusher's
`headroom_retrieve` tool. It also ships a host-wide SQLite storage MCP server
behind the fail-closed `storage_enabled` toggle (see `## Storage server`); the
mod persists `/headroom` counters in it.

## Layout

- `.mcp.json` — registers `mcp/server.mjs` directly (no wrapper, no args) under
  the key `storage`, with env `INLINE_HEADROOM_STORAGE_ENABLED` =
  `${user_config.storage_enabled}`. `CLAUDE_PLUGIN_DATA` gets no `env` entry:
  Claude Code exports it to stdio MCP servers.
- `mcp/server.mjs` — the storage server: one zero-dep executable `.mjs`
  (`100755`, `#!/usr/bin/env node`) with two modes, the per-session stdio MCP
  front-end and the detached `--service <dataDir>` singleton. Its pure exports
  (`isStorageEnabled`, `resolveStorage`, `migrate`, `execOp`, `PROTOCOL`,
  `MIGRATIONS`) are tested by `test/inline-headroom/storage.test.mjs`; an
  `isMainModule()` guard keeps that import free of side effects.
- `hooks/hooks.json` — exactly `{"modules": ["./register.ts"]}`.
- `hooks/register.ts` — every hook and every `$` use, typed via
  `import type { EngineInterface, Register } from 'claude-code'`. No `any`, no
  `import()` (a module holding `import()` does not load).
- `hooks/policy.mjs` — pure, zero-dep, JSDoc-typed logic with no clock reads
  (time comes in as arguments). It must never reference `$`: the engine rejects
  passing the mods API into functions imported from another file. It also
  rejects `$.<noun>` as a bare value (bound, passed or read), so same-file
  helpers in `register.ts` take the whole `$` typed `EngineInterface`.
  It is `.mjs` (not `.ts`) so the root toolchain covers it in CI:
  `tsconfig.json` (`plugins/**/*.mjs`), ESLint, and `node --test` via
  `test/inline-headroom/policy.test.mjs`. It also holds the SmartCrusher port
  (see `## SmartCrusher`).
- `tests/inline-headroom.test.ts` — hook-wiring tests for `claude plugin test`.
  Local only: CI runners have no `claude` CLI; `test/inline-headroom/test.bats`
  runs `claude plugin validate` and `claude plugin test` when `claude`
  is on `PATH` and skips them otherwise.
- `.claude-plugin/types/` is written by the engine (typings + tsconfig) at every
  `claude --plugin-dir` load and is gitignored (`plugins/*/.claude-plugin/types/`).
  No committed per-mod `tsconfig.json`.

## Tests

```bash
# CI (Node 24): policy.mjs and the storage server (test/inline-headroom/*.test.mjs)
pnpm run test:unit
# CI: manifest and wiring only
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/inline-headroom/
# local only
claude plugin validate plugins/inline-headroom && claude plugin test plugins/inline-headroom
```

Every test that needs `node:sqlite` or spawns processes lives in
`storage.test.mjs`: the CI bats job runs on the runner's default Node without
`setup-node`. Its cleanup SIGTERMs every `--service` process for its temp data
dir, so no daemon outlives the suite.

The bats version-pin test (`plugin.json version is 0.6.0`) is a rolling pin:
every version bump rewrites its name and expected value in the same commit.

## Storage server

Invariants for `mcp/server.mjs`:

- Node built-ins only (`node:` imports), no npm dependency, no bundling, one file.
- No static `node:sqlite` import. Only `--service` mode loads it via
  `await import("node:sqlite")`, so the front-end starts on any Node. Storage
  needs Node >= 22.13; Bun lacks `node:sqlite`, so there is no
  `bin/mjs-launch.sh`.
- All SQLite access happens in the `--service` process. It holds `storage.db`
  under `PRAGMA locking_mode=EXCLUSIVE` + `journal_mode=WAL` from start to exit.
  That lock is the host-wide election: a second service gets `SQLITE_BUSY` and
  exits 0. Only the lock holder unlinks a stale `storage.sock` and listens.
- Front-end stdout carries JSON-RPC only; the per-call debug log is gated by
  `MCP_HOOK_DEBUG`. The service never writes stdout; its stderr is
  `${CLAUDE_PLUGIN_DATA}/service.log`.
- Linux, macOS and WSL2 only: the service socket is a path-based Unix socket, so
  `callService` refuses on `win32` (native Windows is a spec non-goal; its
  `net.listen` would need a `\\.\pipe\` name). `storage_enabled` still defaults to
  `true` there; calls just return the "unsupported" error.
- Data lives only under `CLAUDE_PLUGIN_DATA` (`storage.db`, `storage.sock`,
  `service.log`). There is no fallback directory: an unset, blank or
  uninterpolated value refuses storage.
- `storage_enabled` is fail-closed (only the trimmed literal `"true"` enables)
  under the state-creating exception of `.claude/rules/plugin-userconfig.md`.
  Disabled means `tools/list` is `[]` and no file or process is created.
- The front-end retries `ENOENT`/`ECONNREFUSED`/`ECONNRESET` and a reply-less
  close (a service shutting down). Every op is idempotent, so a retry is safe
  (`kv_delete` may report `deleted:false` if the first attempt had applied;
  `stats_put` is an absolute upsert plus a date purge, so a replay is a no-op). The
  60 s failure cool-down gates only spawning: a live service is always tried first.
- The service shuts down (idle or SIGTERM) by closing its listener and draining
  accepted connections for at most 1 s before releasing the DB lock. A lost
  election logs one line to `service.log` only when no live service answers.
- `PROTOCOL` (an integer, now `2`) must be bumped on any op or schema change. A
  newer front-end SIGTERMs an older service; an older front-end refuses a newer
  one. A service whose plugin version (read from `plugin.json`, never a literal)
  is older than the front-end's is also retired after answering, so a service-side
  fix without a `PROTOCOL` bump still takes effect. A pid is only signalled when
  `/proc/<pid>/cmdline` (where `/proc` exists) shows a `server.mjs --service`
  process. `MIGRATIONS` is append-only and additive once released: never edit,
  reorder or remove a released entry. `migrate` refuses a schema newer than the code.
- `execOp` is the single trust boundary, requests at most 2 MiB. Key checks
  apply to `kv_*` ops only: keys 1–512 chars, values at most 1 MiB serialized
  JSON. The stats ops validate real calendar days (`isDay`), the writer
  (`^[A-Za-z0-9_-]{1,64}$`) and counters (non-negative safe integers), and
  `stats_put` takes at most 31 rows. `stats_sum` reads its `SUM` as BigInt: a sum of
  safe-integer rows can pass 2**53, which a plain `node:sqlite` read rejects with
  `ERR_OUT_OF_RANGE` (it answers Numbers, so past 2**53 they are approximate).
  Accepted exposure: the model can call
  `stats_put` directly and overwrite any writer's row for a day, and since the
  purge is global and the caller picks `purgeBefore` (e.g. `9999-12-31`), it can
  delete every writer's rows. Same class as `kv_set`/`kv_delete`; the service is
  clock-free by design, so it cannot bound `purgeBefore`.
- Downgrade hazard: once a 0.3.0 service has migrated `storage.db` to schema v2,
  a 0.2.0 service refuses to start (`database schema v2 is newer than this plugin (v1); update inline-headroom`)
  and storage stays unavailable until the plugin is updated again. Intended
  append-only behaviour.

Key naming convention for consumers (documented, not enforced): a `<feature>/`
prefix, e.g. `notes/<sessionId>`. A feature that needs a table, `kv_list` or a
query adds a new `MIGRATIONS` entry and op plus a `PROTOCOL` bump.

`/headroom` counters live in the `stats` table (`MIGRATIONS[1]`), not in kv:
primary key `(day, writer)`; `day` is the mod's local calendar day `YYYY-MM-DD`
(computed in the mod, never by the service); `writer` is a random id per module
load (`WRITER` in `register.ts`); the counter columns are `steps`, `clamped`,
`cache_drops`, `input_tokens`, `cache_read_input_tokens` and
`cache_creation_input_tokens`, the order `STATS_KEYS` (`server.mjs`) and
`COUNTER_KEYS` (`policy.mjs`) share and a storage test pins. Rows hold absolute
totals and a writer only replaces its own, so concurrent sessions never share a
row and a hot reload (a new `WRITER`) never shrinks a stored total. The today /
7 days / 30 days rows are `stats_sum` from `windowStart(today, n)` on; every
`stats_put` deletes the rows before `windowStart(today, 30)`.

Deviation from `.claude/rules/hooks-mcp-server.md`: the `.mcp.json` key is
`storage`, not `<name>-hooks`, because this server backs no `mcp_tool` hook and
`hooks.json` never references it. `/headroom` persistence is the first mod-side
consumer; `$.mcp.connect("storage")` from the mod stays under Not yet
live-verified until a live run confirms it.

## SmartCrusher

A port of upstream headroom's dict-array lossy path
(`crates/headroom-core/src/transforms/smart_crusher/`, read 2026-10-10) into
`hooks/policy.mjs`: adaptive K (`computeOptimalK`: simhash diversity plus the
Kneedle knee of the bigram coverage curve, 3 to 15 rows), the analyzer (field
stats, pattern, the crushability gate and the strategy), the four planners
(smart sample, top N, cluster sample, time series), the anchor selector, the
must-keep sets (error keywords, structural outliers, numeric anomalies, change
points), query anchors with BM25-boosted relevance (`crushQuery` builds the
query from `$.session.messages()`), and prioritization. Upstream's defaults are
module constants, with no config object: 5 rows to analyze, at most 15 kept,
variance threshold 2, relevance threshold 0.3, depth 50, and `CRUSH_MIN_CHARS`
800 (200 tokens at 4 chars per token).

Deviations from upstream:

- A pure-JS two-lane `hash64` replaces MD5 (simhash grams) and SHA-256 (the
  12-hex CCR hash); dedup and cluster keys are the sorted-key JSON and the
  50-code-point prefix themselves. `node:crypto` and `node:zlib` stay out: a
  mods module is not known to load node built-ins, and a refused import would
  unload every lever.
- `compute_optimal_k`'s zlib tier is skipped (it can only raise K by 20%).
- A document holding a number whose double prints as another decimal (more than
  17 significant digits, an integer beyond 2^53, an overflow to `Infinity`), a
  `-0` or a duplicate object key is passed through (`JSON.parse` then
  `JSON.stringify` would corrupt it; `isLossy` scans the text for each). Number
  lexemes that survive are re-rendered (`1.50` → `1.5`), and integer-like object
  keys come first (a JS object rule).
- The tool-digest marker is omitted: the mod rewrites each result once, at
  `tool.call`.
- A query token or anchor found in more than half the rows is ignored
  (`isSelective`); upstream counts it, so a key name in the query marks every
  row relevant and the crush degrades to the head rows.
- A document that loses no row passes through with its exact bytes; upstream
  also minifies a pretty-printed one.
- `crushQuery` counts only user messages with text toward its last five: a
  Claude Code tool result is a user message with empty text, so upstream's
  count would drop the user's request after five tool calls.
- JS regex `\b` is ASCII-only where Rust's is Unicode, and lengths count UTF-16
  code units where upstream counts UTF-8 bytes (length score, quoted anchors).
- Deferred: lossless compaction, the string, number and mixed-array crushers,
  opaque-blob CCR, TOIN / `preserve_fields`, `factor_out_constants`,
  `include_summaries` and the embedding scorer (stubbed upstream too).

Wiring in `register.ts`:

- The module's one matcher-less `tool.call` hook (registered while
  `effort_routing_enabled` or `smart_crusher_enabled` is on) observes effort
  errors first, answers `mcp__inline-headroom__headroom_retrieve` itself from
  the in-memory `offloaded` `Map` (1000 entries and `CCR_MAX_CHARS` characters,
  oldest evicted, no TTL; upstream caps by count only;
  `session.start` registers the tool), and then crushes.
- A result where `isToolError(r)` is true is never rewritten. A crush needs
  all of: `smart_crusher_enabled`; `retrieveReady` (this module load registered
  the tool under `RETRIEVE_TOOL`); no `e.agentId` (the tool is not known to be
  callable in subagents); `next.origin.plugin === "engine"` (the model's own
  call, never another plugin's `$.tool.call`; a missing `origin` fails open);
  and `isCrushCandidate` (Bash stdout or MCP JSON text blocks that parse, so the
  transcript fetch is paid only for real JSON, never `headroom_retrieve` or the
  mod's own `mcp__plugin_inline-headroom_storage__*` tools).
- A rewrite is a new `{ result }` that carries `next`'s `context` over
  unchanged (user decision); every passthrough returns `r` itself, and
  anything thrown after the error check returns `r` (fail open).
- The `smart crusher` table's `crush.dropped` and `crush.saved` are
  session-only and reset on `session.end`. Persisting them needs new `stats`
  columns, a `MIGRATIONS` entry and a `PROTOCOL` 2 → 3 bump, so it is deferred.

## Verified Claude Code 2.1.288 shapes relied on

- `turn.step` input `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`;
  `index: number` (0 = the user-ask step); `agentId?: string` set for subagents.
- `tool.call` result: failure is `isError: true` or `deny: string`; there is no
  `exitCode` (a failing Bash command surfaces as `isError: true`).
- `PromptComposeSection.scope` is `'shared' | 'session'`; `prompt.compose` returns
  `{ sections }` and this mod returns `next(e)`'s result unchanged.
- `turn.step` result `usage` may be `null`.
- `command.run` returning `{}` prints no transcript row and records no model
  context (`CommandRunResult.text` absent).
- One hook per event without a matcher. Verified on 2.1.296, not 2.1.288: a
  module with a second matcher-less `on("turn.complete")` fails both
  `claude plugin validate` and `claude plugin test`, with the error
  `registered twice without a matcher`. The subagent error cleanup therefore
  shares the one `turn.complete` hook with the storage write, registered while
  `storage_enabled` or `subagent_effort_routing_enabled` is on. `tool.call`
  likewise has one hook, which observes effort errors, answers
  `headroom_retrieve` and runs the SmartCrusher, registered while
  `effort_routing_enabled` or `smart_crusher_enabled` is on.
- Read from the typings (`claude-code.d.ts`), not live-run:
  - `tool.call` resolves to one of three `ToolCallResult` variants: `{ deny }`,
    an answered `{ result, context?, ref?, text? }`, or
    `{ isError: true, result, text?, ref?, context? }`.
  - Core validates a hook's own `{ result }` against the tool's output schema
    and maps it for the model with the tool's own mapper; `ref` and `text` are
    absent on it. `context` (`readonly string[]`, other hooks' reminder text) is
    "kept whole from `next`", but the typings do not say core restores it on a
    hook's own `{ result }`, so the crusher carries `r.context` over itself.
  - The Bash record has `stdout`, `stderr`, `interrupted`, `isImage?`,
    `backgroundTaskId?`, `timedOutAfterMs?` (set when the command hit its
    timeout and was backgrounded), `rawOutputPath?`, `persistedOutputPath?` and
    `structuredContent?`; the candidate guard reads each.
  - `$.tool.register` in the first `session.start` (which is awaited) is listed
    by turn one; a reload's `session.start` registers again; `/clear` fires
    none.
  - The test kit's `$` is engine-origin (`next.origin.plugin === "engine"`).
- Test kit: every `on(...)` stub must be registered before the test's first `$`
  call; a later one throws `on("<event>") after the test first called $`. The
  crusher tests stub `command.register`, `tool.register` and `session.messages`
  (answering `{ value }`) plus a bottom `session.start`, then fire
  `$.session.start({ cwd, surface, isInteractive })`.
- `$.ui.open(PaneOpenArgs)` resolves to `UiOpenResult`
  (`{ isPlaced: true } | { isPlaced: false, reason }`). `focus`/`closeOnEscape`
  accept only `true`. One pane per id, and re-opening retitles it.
- The `ui.render` matcher `{ component: "Pane", requestId }` selects only that
  pane and scopes `$.ui.invalidate("ui.render")` to it. Elements come from
  `$.ui.resolve(e)` as plain function calls (`Box({...})`, `Text({ children: [...] })`),
  so the module stays `.ts` without JSX.
- Test kit: `$.ui.open` needs an `on("ui.open", ...)` stub answering
  `{ value: { isPlaced: true } }`, registered before the test's first `$` call.
  The kit answers `$.ui.invalidate` itself. Panes are asserted with
  `$.ui.mount(...)` and `find({ type: "Text", text })`; a string `text` is a
  substring match (`"1"` also finds `17`), so anchor a regex (`/^17$/`) to
  find one cell. A test's own `$` has no `ui.close`: a test closes a pane
  through an inline helper plugin (`test(name, { plugins: [closer] }, ...)`)
  whose command calls `$.ui.close({ id })`, plus a mandatory bottom
  `on("ui.close", ...)` stub answering `{ value: undefined }` or `{ deny }`
  (without one the kit fails with `no implementation for ui.close`).
- `session.end` input is `{ reason, sessionId, resume: { id } }` and `next(e)`
  resolves `{ sessionId }`; `reason: "clear"` is a `/clear` (the process goes on
  under a new session id).
- `turn.complete` input carries `agentId?` (absent on the main loop) and a
  required `reason`; `next(e)` resolves `{ text }`.
- `$.mcp.connect(key)` never rejects: it resolves `{ isConnected: true, server }`
  or `{ isConnected: false, reason, message }`. Read from the 2.1.289 engine binary (no live run yet): `key` is the
  bare key from this plugin's own `.mcp.json` (`"storage"`), not the
  `plugin:<name>:<key>` form, which is for `mcp_tool` hook `server` fields and
  for `$.mcp.call`. The engine namespaces the key itself; the resolved `server`
  is the namespaced name `$.mcp.call` takes. An unknown key resolves
  `{ isConnected: false, reason: "unlisted", message }` with the message
  `This plugin's manifest lists no MCP server named "<key>".`
  `$.mcp.call(server, tool, args)` resolves
  `{ content, isError, structuredContent? }`; `structuredContent` is typed only
  for tools with an `outputSchema`. Kit stubs: `on("mcp.connect", ...)` and
  `on("mcp.call", ...)` answering `{ value: ... }`; the connect stub must answer
  only for the bare key, as `stubStorage` does.
- `claude plugin validate` refuses `$.mcp` (any `$.<noun>`) as a bare value; a
  same-file helper taking the whole `$: EngineInterface` validates, and its calls
  are listed as `$.mcp.call (via callStorage)`.
- `Box` `flexDirection`/`width`/`justifyContent`/`gap` and `Text`
  `bold`/`dimColor` mount and validate in a Pane.
- Test kit: `$.clock.now()` needs `mock.clock(on, { now })` (from
  `claude-code/testing`). The `$` calls the unawaited flush chain makes after
  `turn.complete` returned run once the test calls `clock.advance(0)`.
  `clock.advance(ms)` fires a module's `$.clock.every` periods exactly on the
  boundary (`advance(9_999)` fires none of a 10 s period, a further
  `advance(1)` fires one).

## Not yet live-verified (kit only)

Shipped on kit and typings evidence only. The user-run live check in the PR
moves each confirmed entry into the section above and records any failure here;
delete this heading once it is empty.

- Mod-side `$.mcp.connect("storage")` from the real engine.
- Whether `structuredContent` is forwarded for a tool without `outputSchema`
  (the mod falls back to the JSON text block either way).
- `$` honoured by the real engine after a `turn.complete` hook returned
  (fallback: `await flushing` inside the hook).
- `$.clock.every` started in a `command.run` hook keeps firing with that hook's
  `$` after the hook returned (the 10 s pane refresh).
- `$.clock.every` started in a `ui.render` hook (the re-arm after a hot reload)
  keeps firing with that hook's `$` after the hook returned.
- The mod's `ui.close` hook (matcher `{ id }`) runs on Esc and Ctrl+X X, so
  closing the pane stops the refresh.
- Agent-tool subagents and Workflow agents raise `turn.step`, `tool.call` and
  `turn.complete` with their `agentId`, stable across that agent's steps, with
  `index` restarting at 0 per agent turn.
- The engine honours a lowered `effort` returned from a subagent `turn.step`
  hook.
- `turn.complete` fires for an aborted or killed subagent (otherwise its error
  entry lives until `session.end`).
- A background session's main loop carries no `agentId` (if it does, its steps
  follow the subagent toggle and count in the `subagents` row).
- An MCP tool's core `result` in `tool.call` is `{ content: McpContentBlock[], … }`
  (otherwise the guard never matches and MCP results pass through).
- A hook-rewritten Bash `{ result }` passes core's validation and reaches the
  model as the crushed stdout.
- The real engine resolves `$.tool.register` to
  `mcp__inline-headroom__headroom_retrieve`, routes the model's call through
  the `tool.call` chain to the matcher-less hook, and the `{ result: string }`
  answer reaches the model as text.
- `next.origin.plugin === "engine"` for the model's own tool calls (otherwise
  nothing is crushed).
- Whether the first `headroom_retrieve` call raises a permission prompt.

## Effort-routing caveat

Upstream headroom removed effort routing after measurement (~$0.0007 saved per
mechanical turn vs ~$0.011 cache re-write per effort switch). `effort_routing_enabled`
still defaults to `true` per `.claude/rules/plugin-userconfig.md`; the
`effort_routing_enabled` toggle, the per-step `cache drop` log and the
`/headroom` drop count are how a user measures whether it pays off. The
`cache drop` log and the drop count cover the main loop only.

`subagent_effort_routing_enabled` (default `true`, active only with
`effort_routing_enabled`) applies the same clamp per `agentId`. It is a separate
toggle (user decision) because the clamp overrides deliberately set effort
(agent frontmatter `effort`, Agent tool `effort` param, Workflow `effort`
option) and each subagent pays its own cache re-write on the switch, which
`/headroom` does not measure. Its counters live in memory only (the `subagents`
row); the persisted `stats` schema stays main-loop.

## Releases

Never use `claude plugin tag`: its `{name}--v{version}` tag scheme conflicts with
`tag-on-version-bump.yml`, which tags `<name>-<version>` from the `plugin.json`
version.
