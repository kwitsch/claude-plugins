# CLAUDE.md — inline-headroom

Mods-API plugin (the repo's first): one TypeScript function-hooks module, no
skills/agents/command hooks. Thirteen levers, each behind a boolean
`userConfig` toggle (`effort_routing_enabled`, `cache_aligner_enabled`,
`smart_crusher_enabled`, `lossless_compaction_enabled`,
`cross_turn_dedup_enabled`, `dense_line_elider_enabled`,
`config_compressor_enabled`, `html_extractor_enabled`,
`log_compressor_enabled`, `search_compressor_enabled`,
`diff_compressor_enabled`, `text_crusher_enabled`, `relevance_split_enabled`),
plus `subagent_effort_routing_enabled`, which extends effort routing to subagent
and Workflow-agent steps and is active only while `effort_routing_enabled` is
on, `subagent_compression_enabled`, which extends the eleven compression levers
to subagent and Workflow-agent tool results and is active only while one of
them is on, and `tag_protector_enabled`, which keeps custom workflow tags whole
across the compression levers (all sixteen `default: true`, only literal
`false` disables; `storage_enabled`, the seventeenth `userConfig` key, is
fail-closed), plus the
`/headroom` stats command and the compression levers' `headroom_retrieve` tool.
It also ships a host-wide SQLite storage MCP server behind the fail-closed
`storage_enabled` toggle (see `## Storage server`); the mod persists
`/headroom` counters in it.

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
  `test/inline-headroom/policy.test.mjs`. It also holds the content router and
  the SmartCrusher (with its lossless compaction stage), cross-turn dedup,
  dense line elider, config compressor, HTML extractor, log compressor, search
  compressor, diff compressor, text crusher and relevance split ports, and the
  tag protector (see their sections).
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

The bats version-pin test (`plugin.json version is 0.8.1`) is a rolling pin:
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
consumer.

Every mod-side storage call must be awaited by a running hook of this module
(live on 2.1.296): core routes `$.mcp.call` through `$.tool.call` and its
permission check, although the typings promise no prompt. A plugin's own hooks
see a call it raises only while one of its hooks runs; a call raised after the
hook returned (an unawaited chain, a `$.clock.every` callback) skips them, so
in `default` mode the user gets a permission dialog per call and a headless
session denies it. In-frame, the module's `tool.check` hook allows it
(`isOwnStorageCall`). Hence: `turn.complete` awaits its `stats_put`,
`command.run` awaits the first `stats_sum`, and a refresh tick only sets
`stale` and redraws, so the `ui.render` hook fetches.

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
  `session.append`.
- Candidates are tool_result texts as the model reads them, from any tool; the
  Bash record guards are dropped because each guarded case renders text that is
  not one JSON document, so the whole-document parse rejects it. Read results
  carry `N\t` line numbers and never parse as JSON (nor as HTML: see `## Content router`). A row carries no `context`, so the
  former `context` carry-over is moot, and a subagent row's query comes from
  `$.session.messages({ agentId })`. The crusher's thresholds and algorithm are
  unchanged.
- A query token or anchor found in more than half the rows is ignored
  (`isSelective`); upstream counts it, so a key name in the query marks every
  row relevant and the crush degrades to the head rows.
- A document that loses no row passes through with its exact bytes; upstream
  also minifies a pretty-printed one.
- `crushQuery` counts only user messages with text toward its last five: a
  Claude Code tool result is a user message with empty text, so upstream's
  count would drop the user's request after five tool calls.
- `crushQuery` keeps at most `CRUSH_QUERY_INPUT_CHARS` (16,384) characters of
  assistant tool-call input JSON in all, newest first; upstream has no cap. A
  subagent has one user message, so its walk would otherwise stringify every
  input back to the agent's start on each JSON result (O(n²) over its life).
- JS regex `\b` is ASCII-only where Rust's is Unicode, and lengths count UTF-16
  code units where upstream counts UTF-8 bytes (length score, quoted anchors).
- Deferred: opaque-blob CCR, TOIN / `preserve_fields`, `factor_out_constants`,
  `include_summaries`, tabular ingest (CSV text turned into records: upstream's
  own lossless-first stage makes it a no-op on CSV, and the markdown and
  fixed-width tables it would also take need the omitted detector branches
  plus a CSV parser) and the embedding scorer (stubbed upstream too).

Default-behaviour change of this lever (0.7.0): with
`lossless_compaction_enabled` on (the default) the lossless table of
`## Lossless compaction` is tried first and usually wins on a uniform dict
array, so the model sees a schema table (a JSON string holding `[N]{…}` and CSV
rows where the array stood) instead of sampled rows plus a `_ccr_dropped`
sentinel, and nothing is dropped. The crushed text is still one compact JSON
line, so what dedup and the elider see does not change.
`lossless_compaction_enabled: false` restores the lossy-only output.

### String, number and mixed-array crushers

The remaining arms of upstream `process_value` (`crushers.rs`
`crush_string_array`, `crush_number_array` and `compute_k_split`, and
`crusher.rs` `classify_array`, `crush_mixed_array` and
`append_scalar_drop_sentinel`, read 2026-10-11 at 976aa71), as
`crushStringArray`, `crushNumberArray`, `crushMixedArray` and
`numberChangePoints`. They are part of `smart_crusher_enabled` (arms of one
upstream component behind one toggle), run only with the lossy stage, and
count their dropped items in the `smart crusher` table's `dropped`.

Ported verbatim:

- `classify_array`: an array of one JSON type is a dict, string or number
  array; bool-only, nested-only and empty arrays are recursed into; any mix of
  types, or any null, is mixed. Only arrays of 5 or more items are classified.
- `compute_k_split` with the BUG #4 clamp: the adaptive K, its first 30% and
  last 15% (at least 1 each, rounded half to even), clamped so both fit in K.
- The string crusher: 8 or fewer items pass through; error-keyword items,
  length anomalies (code points more than 2 sample σ from the mean) and the
  first and last K always stay; a stride tops the kept set up to K plus the
  errors and anomalies, skipping repeats of a kept string; the order is kept.
- The number crusher: outliers (more than 2 sample σ), change points (more
  than 10 numbers, window 5, the mean of the 5 before against the 5 from each
  index, more than 2σ apart, no spacing rule) and the first and last K stay; a
  stride tops the kept set up to K plus the outliers.
- The mixed crusher: groups by JSON type in first-seen order, a group under 5
  items kept whole; the dict group through the dict path with the caller's
  stages (a winning table keeps the group whole, dropped rows matched back by
  sorted-key JSON), the string group keeping every copy of a kept string, the
  number group its first and last K plus its outliers, every other group whole.
- A string, number or mixed array is never descended into, whether or not it
  lost items; one that lost items ends with the string sentinel
  `… N more items <<ccr:HASH N_items_offloaded>>` (U+2026), its compact JSON
  stored under the hash. Without the lossy stage (`lossless_only`) such arrays
  stay whole.

Deviations:

- Number items feed `compute_k_split` as `String(n)` where upstream keeps the
  original lexeme (`1.0`, `1e21` spell differently), a minor simhash
  difference.
- The strategy/debug string (and its percentile logic) is not ported: nothing
  reads it.
- `numberChangePoints` is its own helper: the dict analyzer's `changePoints`
  needs 10 values and keeps a point only more than 5 past the previous one,
  which upstream's number crusher does not.

Behaviour change of this lever (0.7.0): string, number and mixed arrays of 9
or more items inside a crushable document now lose items behind the sentinel
above, and string, number and mixed arrays of 5 to 8 items are no longer
descended into (a dict array nested in one stays whole), as upstream.

Behaviour change of this lever (0.7.0): with `tag_protector_enabled` on (the
default) a JSON text holding a custom tag (see `## Tag protector`) runs without
the lossy stage, so no row or item of it is dropped; lossless compaction may
still rewrite it, every string staying verbatim in a cell.

Wiring in `register.ts`, shared by every compression lever:

- One `session.append` hook with the matcher `{ door: "tool-result" }`,
  registered while any compression lever is on (`compressOn` in
  `register.ts`), rewrites each tool-result row before it is
  first stored and sent, so the model, the transcript file and every later
  request read one form (prompt-cache safe). `rewriteToolResults` (pure, in
  `policy.mjs`) labels each text with `detectContentType`, runs that type's
  `ROUTES` steps (crush then elide for `json_array`, config then elide for
  `structured_config`, extract then elide on the extraction for `html`, log,
  logfold then elide for `build`, search, searchfold then elide for `search`,
  diff, difffold then elide for `diff`, split, textcrush, textfold then elide
  for `text`, elide alone for `tabular` and `source_code`), then deduplicates a
  single-text result (see `## Content router`).
- Gates, each passing the row through with `next(e)`: `retrieveReady` (this
  module load registered the tool under `RETRIEVE_TOOL`; a marker must never
  name a missing tool), `origin.kind === "tool"`, and a subagent row
  (`e.agentId`) only while `subagent_compression_enabled` is on.
- Protected rows are never rewritten: a block with `is_error === true`, and
  every block of a `headroom_retrieve` row (matched by tool name in any
  namespace: the full name, the bare name or another server's, since a row's
  `origin.tool` for a plugin-registered tool is not live-verified) or an
  `mcp__plugin_inline-headroom_storage__*` row (a `kv_get` → edit → `kv_set`
  would write the loss back to `storage.db`). Dedup still indexes them as
  originals.
- `wantsQuery` gates the `$.session.messages()` fetch (`{ agentId }` for a
  subagent row; a `{ deny }` means an empty query), so the transcript is read
  only for a row holding a JSON document the crusher may rewrite or, while the
  search compressor, the diff compressor, the text crusher or the relevance
  split is on, any non-Read text of 300+ characters (`register.ts` passes its
  `levers` as `wantsQuery`'s third argument); a failed fetch compresses without
  query signals (the relevance split then declines).
- `next` is called exactly once on every path and its answer is returned
  unchanged. Any throw before it (the fetch, the pipeline) passes the row
  through unchanged (fail open), and a throw inside `rewriteToolResults` first
  empties that conversation's dedup corpus (a block indexed before the throw
  belongs to a row stored as made); a rejection from `next` itself empties the
  corpus the same way and propagates (no trigger is known: the kit skips a
  throwing hook beneath instead of rejecting). A downstream hook that replaces
  or drops the row after `next` resolves is not detected.
- Every dropped original goes to an in-memory `Map` through `storeOffloaded`
  (1000 entries and `CCR_MAX_CHARS` characters each, oldest evicted, no TTL;
  upstream caps by count only), in two stores so dedup churn never evicts a
  sole copy: `offloaded` holds the crusher's, the elider's, the config
  compressor's, the HTML extractor's, the log, search and diff compressors',
  the text crusher's and the relevance split's originals, which exist nowhere
  else, and `folded` holds dedup runs, whose earlier copy is still
  in the transcript until a compaction. `storeOffloaded` never evicts an entry
  of the batch it was just given (a row's markers always resolve, even when it
  folds more than 1000 runs), so a store may sit over a cap until its next call
  with entries.
  Both stores are module memory only: a mod reload (an options change, a plugin
  update) or a resumed session loses every original while the transcript keeps
  the markers, and `headroom_retrieve` then denies the hash. Persisting them in
  the storage server is deferred (a `kv_set` value is capped at 1 MiB, and each
  write would be an awaited storage call inside the append hook).
- The module's one matcher-less `tool.call` hook (registered while
  `effort_routing_enabled` or any compression lever is on) observes effort
  errors and answers `mcp__inline-headroom__headroom_retrieve` itself from
  `offloaded`, then `folded` (`session.start` registers the tool); a miss is a
  `{ deny }`, which the effort observer counts as a failure. `retrieveKey`
  accepts the bare hash, `hash=H` and a whole `<<ccr:H …>>` marker, and drops
  the closing `]` or `>>` of a copied marker (a dedup pointer and an elider line
  end in `]`), because the tool's description cites the marker forms.
- Model-only holds structurally: a tool-result row answers a `tool_use` block
  of the model's response, and a `session.append` rewrite never changes what a
  plugin's `$.tool.call` resolves to.
- The compression tables' counters (`smart crusher`, `dedup`, `line elider`,
  `compaction` and every later lever's) are session-only and reset on
  `session.end`. Persisting them needs new `stats` columns, a `MIGRATIONS`
  entry and a `PROTOCOL` 2 → 3 bump, so it is deferred.

## Lossless compaction

A port of upstream headroom's lossless-first SmartCrusher stage
(`crates/headroom-core/src/transforms/smart_crusher/compaction/compactor.rs`,
`formatter.rs` and `classifier.rs`, and `crusher.rs`
`crush_array_with_source`, read 2026-10-11 at 976aa71) into
`hooks/policy.mjs` as `compactRows`, `formatCsvSchema` and `compactionJson`,
run by `crushDictArray` inside the `crush` step, before the lossy path. It has
its own toggle, `lossless_compaction_enabled`, and its own `compaction` table
(`arrays`, `saved`). With the SmartCrusher's toggle it maps onto upstream's
configurations: both on is `SmartCrusher::new` (the default), the crusher alone
is `without_compaction`, and compaction alone is `lossless_only`.

Ported verbatim:

- The defaults: at least 2 items, a core field in 80% of the rows, the
  heterogeneous core ratio 0.6, at most 6 flattened inner keys, 2 to 8 buckets,
  the discriminator uniqueness cap 0.7, and the lossless savings floor 0.15
  against `estimate_array_bytes` (the rows' compact JSON plus their commas and
  brackets).
- `crush_array_with_source`'s order: an array within the adaptive K is left to
  recursion before compaction is tried; a winning table replaces the array as a
  string; without the lossy stage (`lossless_only`) an array whose table did
  not win stays whole and is not descended into.
- `compact_inner`: fewer than 2 items or a non-object item stays untouched; key
  frequencies over the sorted key set; buckets by a discriminator (in every
  row, all strings, 2 to 8 values, at most 70% unique; most buckets wins, the
  first key on ties) when under 60% of the keys are core, each bucket compacted
  on its own and a bucket that is no table rendered as a one-column
  `value:json` table; otherwise one table, columns by descending frequency,
  then name.
- `infer_type_tag` (the first non-null type, `json` on a conflict, `string`
  when all null), nullability (a missing key or a null), `cell_from_value` with
  opaque markers off (an array of 2+ objects nests; a string holding a JSON
  object or array, and no `<<ccr:` marker, is replaced by its value or a nested
  compaction), and `flatten_uniform_nested` (1 to 6 identical inner keys,
  order-sensitive, never on a dotted column; types and nullability re-inferred
  from the cells).
- The csv-schema format without a drop summary: `[N]{name:type,name:type?,…}`,
  one CSV row per record, each line ending in `\n`; `__buckets:<disc>` and
  `__key:<value>` lines; a missing key empty, `null` bare, `""` and `"null"`
  quoted; CSV quoting of `,` `"` `\n` `\r`; a string a `json` column could read
  as a value written as a quoted JSON literal; a nested cell as quoted
  `compaction_to_json`. `process_string`'s rule: a stringified array that
  compacts becomes the table string itself, never a double-encoded one.
- A top-level array that compacts comes back as a JSON string literal holding
  the table (upstream's wrapper, documented by compaction_codec.py `_peel`).
  Its `\n` escapes can make it fail the crusher's existing not-shorter gate
  after it passed the 15% floor, as upstream.

Deviations:

- A column name holding `,` `:` `{` `}` `?` or a line break leaves the array
  untouched, and such an inner key keeps its column nested: upstream writes
  names unescaped, so the header would no longer decode, and a lossless rewrite
  keeps no CCR copy.
- A stringified cell whose value `JSON.parse` would not render back the same
  (`isLossy`) stays a string, so no digit or duplicate key is lost.
- One compaction's work (key reads plus table cells) is charged to a budget of
  4 per character of the array's compact JSON + 4096, and the stage declines
  when it runs out: a sparse key set (thousands of distinct keys) would
  otherwise build a rows × columns table synchronously. Such a table could not
  pass the 15% floor anyway, since every cell renders at least one character.
  The discriminator scan reads values only for keys present in every row, so
  it stays linear in the key occurrences.
- Numbers type as `int` when `Number.isSafeInteger`, else `float`, and cells
  render as `String(n)`: `JSON.parse` keeps no lexeme, so `1.0` reads `int` and
  `1.50` renders `1.5`, where upstream's `arbitrary_precision` keeps both. The
  document still passes `isLossy` first.
- Lengths count UTF-16 units where upstream counts UTF-8 bytes (the savings
  ratio shifts slightly on non-ASCII input); keys sort by UTF-16 code units
  where upstream's `BTreeMap` sorts UTF-8 bytes (different only for astral or
  high-BMP names); JS lists integer-like object keys first, which can change
  the flatten key-list comparison and the dotted column order. No value changes.
- Opaque-blob CCR stays off (`emit_opaque_markers=false` semantics): long
  strings stay verbatim cells and no `<<ccr:HASH,KIND,SIZE>>` cell is written.
- Deferred: the markdown-kv and JSON formatters, the drop summary,
  `factor_out_constants` and TOIN.

Savings: a crushed document that lost nothing books all of its saved
characters to `compaction`; otherwise `compaction` gets the tables' own savings
(capped at the total) and the crusher the rest.

## Cross-turn dedup

A port of upstream headroom's cross-turn verbatim de-duplication
(`headroom/transforms/cross_turn_dedup.py` and the `content_router.py`
`_cross_turn_dedup_messages` wiring, read 2026-10-11 at 976aa71) into
`hooks/policy.mjs` as `dedupBlock`.

Ported verbatim:

- `DEFAULT_MIN_LINES` 3, `DEFAULT_MIN_CHARS` 40 (on the joined span) and
  `MAX_ANCHOR_CANDIDATES` 16, in first-seen order.
- The unpadded line-number regex `^([1-9]\d*)(:|\t)(.*)$`. Leading-zero runs
  never renumber-fold.
- Match keys modulo the line number, with a uniform delta inside a run.
  Non-numbered lines must match exactly.
- The trivial-line set and the `< 4` rule.
- The longest run wins; a tie keeps the earliest. Folded lines become null, so
  they never seed a later match (keep-earliest).
- Only surviving verbatim lines are indexed. Protected blocks (here: error
  results, `headroom_retrieve` and own-storage rows) are indexed as targets and
  never rewritten.
- Only string content or a single non-empty text sub-block takes part.
- Dedup runs after per-block compression, over the final text.
- Prefix-monotonic, because each block matches only strictly earlier output and
  stored rows are immutable.

Deviations from upstream:

- Incremental at append time instead of a per-request batch. The corpus is per
  conversation (the main loop, or one `agentId`) and lives in module memory
  (`dedupStates` in `register.ts`). It is capped at `DEDUP_MAX_CHARS`
  (4,000,000) indexed characters across conversations, emptying the least
  recently appended conversation first (`resetCorpus`), or the current one when
  it alone exceeds the cap. An emptied conversation keeps its ordinal counter,
  so a later pointer never reuses the number of a result that left the corpus.
  The same reset runs on a finished agent's `turn.complete` (its corpus would
  otherwise count toward the cap that evicts the main loop's), on the
  compacting loop's `session.compact` (the results it indexes left the model's
  context; not on a skip or a `precompute`, which installs nothing) and on a
  throw inside `rewriteToolResults`. It is cleared whole on `session.end` and
  lost on a mod reload. Claude Code's own clearing or trimming of old tool
  results without a compaction raises no event, so the corpus keeps such a
  result and later re-reads fold into pointers to text the model no longer
  sees (recovery: `headroom_retrieve` from `folded`); accepted, documented in
  the README Notes.
- The pointer names `result N`, where N is the mod's 1-based ordinal of the
  conversation's indexed tool results, instead of `msg N`. N is the message
  index in upstream's request; the mod has no request-level view at append
  time.
- The pointer appends a space and `hash=H`. Upstream recovery is in context only, but the mod
  also stores the folded run's exact text in the `folded` CCR store, so a pointer whose
  original was compacted away stays recoverable while the mod is loaded.
- Because of that suffix, a fold is emitted only when the pointer is shorter
  than the run. Upstream relies on `min_chars` alone for its net win.
- The anchor is quoted with `JSON.stringify` (always double quotes) instead of
  Python `repr`. It is truncated by code points, as upstream does.
- A line number beyond `Number.MAX_SAFE_INTEGER` is treated as non-numbered.
- A `:` separator directly followed by a digit (`10:15:03 …`, `8080:80`) is not a
  line number: the leading integer is a time or port, so such lines match
  exactly.
- JS `\d` is ASCII-only where Python's `str` regex `\d` is Unicode.
- Lengths count UTF-16 units.

Wiring: `rewriteToolResults` calls `dedupBlock` last, over each tool_result's
final text of every content type (after the crusher or the elider), with the
key `""` for a main-loop row and the `agentId` for a subagent row. Folds count
in the `dedup` table's session-only `spans` and `saved`. A `Read` row is only
indexed, like a protected one (user decision): a re-Read after an Edit must show
the file verbatim for the next Edit's `old_string`, and a later Bash `cat` of
the same file still folds against it. Upstream protects only its verbatim
exclude list (WebSearch, WebFetch, the retrieve tools, `view`).

Behaviour change (0.7.0): with `tag_protector_enabled` on (the default) a line
a custom tag span touches never starts a fold, and a run ends before the first
such line (both mod-side; see `## Tag protector`), so a repeated
`<system-reminder>` block stays verbatim while the runs around it still fold.
Tagged lines are still indexed. A text the tag scan cannot finish within its
budget is only indexed.

## Dense line elider

A port of upstream headroom's dense line elider
(`headroom/transforms/dense_line_elider.py`, the `content_router.py`
`_elide_dense` CCR marker and `recursive_json.py` `scan_json_documents`, read
2026-10-11 at 976aa71) into `hooks/policy.mjs` as `elideDense`.

Ported verbatim:

- `MIN_LINE_CHARS` 300; `MAX_SPACE_RATIO` 0.06, with `>=` rejecting;
  `MIN_DENSE_TOTAL_CHARS` 2000; `HEAD_CHARS` 160; `TAIL_CHARS` 80.
- The early return below 300 characters, the tab guard and the JSON-shaped
  guard.
- The labelled-JSON guard through the span scan (`scanFrom`, `noJsonSpans`),
  including the work budget of 4 per character + 4096, where an incomplete
  scan means not dense.
- The split on `\n` only, the per-line omission note
  `...[N chars of dense machine-generated content elided]...`, and the CCR
  retrieval line `[N dense machine-generated line(s) elided. Retrieve original: hash=H]`
  appended after the block, with the whole pre-elision block stored under the
  hash.
- No elision of text another compressor rewrote (SmartCrusher output; upstream
  `_DENSE_ELIDE_AFTER`).

Faithful-to-upstream consequences (kept, not bugs): a line holding a tab is
never dense, which covers every line of Read output (`N\t…`), and a line is not
dense when the span scan finds any JSON object or array in it, however small
(`{}`, `[1,2]`). A minified bundle with an `exports:{}` span, or any Read of one,
therefore stays whole. Upstream has no minimum span size or tab exemption;
relaxing either would diverge from it, so it is deferred.

Deviations from upstream:

- The 12-hex `hash64`-based `contentHash` stands in for upstream's CCR key, as
  for the crusher.
- A result that is not shorter than its input is passed through. Upstream
  would emit it; seven 300-character dense lines grow by the retrieval line.
- Lengths count UTF-16 code units, where upstream counts code points.
- Head and tail cuts never split a surrogate pair, so a cut may keep one unit
  less.
- `JSON.parse` rejects `NaN`/`Infinity` spans that Python's `json.loads`
  accepts, so such a span does not protect its line. A non-`SyntaxError` parse
  failure counts as an incomplete scan.
- `trim()` and Python `strip()` differ on a few exotic whitespace code points.
- Upstream disables elision in lossless mode; the mod has no lossless mode.
- Applied to every non-error tool result except `headroom_retrieve` and the
  mod's own storage tools.

Wiring: `rewriteToolResults` runs `elideDense` on every content type
(`ROUTES`), on each text the crusher did not rewrite (every text while
`smart_crusher_enabled` is off). Elided lines count in the `line elider`
table's session-only `lines` and `saved`.

Behaviour change (0.7.0): a text labelled `structured_config` (YAML, TOML or
INI) that the config compressor rewrites is no longer elided, as upstream
leaves CONFIG out of `_DENSE_ELIDE_AFTER`; with `config_compressor_enabled`
off, or when the compressor declines, the elider runs on it exactly as before.

Behaviour change (0.7.0): an HTML text the HTML extractor rewrites is elided as
its extraction (the elider runs after the extractor, upstream's
`_DENSE_ELIDE_AFTER` HTML member), so a dense line inside the page's text is
cut there and the page's markup never reaches the elider; the elider's
retrieval line then follows the extractor's, and its stored original is the
extraction. With `html_extractor_enabled` off, or when the extractor declines,
the elider runs on the page exactly as before.

Behaviour change (0.7.0): with `tag_protector_enabled` on (the default) a line
a custom tag span touches is never dense (mod-side; see `## Tag protector`),
and after an HTML extraction the spans are those of the extracted text. A text
the tag scan cannot finish within its budget is not elided at all.

Behaviour change (0.8.0): on `build`, `search` and `text` the elider now sees
the log compressor's, the search compressor's or the text crusher's lossy
output (upstream's `_DENSE_ELIDE_AFTER` LOG, SEARCH and TEXT members), and its
retrieval line then follows that compressor's; after a lossless fold (or, on
`text`, a relevance split) it sees nothing, since those end the route. On
`diff` it sees nothing after a diff-compressor or index-strip rewrite (DIFF is
not in `_DENSE_ELIDE_AFTER`). With the new toggles off, or when every new step
on the route declines, it runs exactly as before.

## Config compressor

A port of upstream headroom's structured-config compressor
(`headroom/transforms/config_compressor.py`, the `collapse_runs`,
`expand_runs`, `fold_repeated_blocks` and `unfold_repeated_blocks` helpers and
`compact_lossless(…, "config")` of `headroom/transforms/lossless_compaction.py`,
and `_try_detect_structured_config` of `content_detector.py`, read 2026-10-11
at 976aa71) into `hooks/policy.mjs` as `compressConfig`, `configFlavor`,
`isIniAssign` and the fold helpers, reached through the content router's
`structured_config` route (`config` then `elide`). It has its own toggle,
`config_compressor_enabled`, and its own `config` table (`texts`, `saved`).

Ported verbatim:

- Detection: the regexes `_CONFIG_SECTION_RE`, `_TOML_ASSIGN_RE`,
  `_YAML_KEY_RE`, `_YAML_LIST_RE`, `_YAML_DOC_RE` and `_CONFIG_COMMENT_RE`; a
  `{` or `<` first character is no config; at least 3 non-empty and 3 body
  lines (comment lines are neutral); TOML/INI needs a section header, 2
  assignments and a 0.6 share, and a text over 1,000,000 characters never
  reads as TOML/INI; YAML needs 3 keys, a 0.6 share of keys, list items and
  document markers, under half the lines ending a sentence, at most 8 words a
  line, and 2 indent levels, a document marker or 3 list items; the markdown
  front-matter guard. The branch sits after log and before code, upstream's
  position (the tabular branch upstream checks in between stays omitted).
- Tier 2: whole-line comments (`^\s*#`; INI only column-0 `#` or `;`) and,
  outside INI, blank lines are dropped behind
  `[N comment/blank lines elided. Retrieve original: hash=H]`, the original
  stored first; skipped for a YAML block scalar (`key: |`, or a sequence item `- |`) or a TOML multi-line string.
- Tier 1: runs of 2+ identical lines become `... (repeated N times)`, then a
  run of 3 to 64 lines repeating the lines D back (K <= D) becomes
  `... (repeats K lines from D lines back)` when its characters exceed the
  marker's, with at most 8 recent positions per distinct line and no fold on a
  text under 6 or over 20,000 lines; kept only when the inverse gives the text
  back exactly and it is shorter. Deviation: when Tier 2 elided nothing, a
  Tier 1 fold appends `[Repeated config lines folded. Retrieve original: hash=H]`
  and stores the original, so a following Edit can get the exact text
  (upstream's Tier 1 markers carry no recovery hint).
- A result that saves less than one character is discarded, its stored
  original with it.

Deviations:

- Line-level checks stand in for `tomllib` and `configparser`: a section text
  is TOML when every assignment is a TOML key whose value lexeme reads as TOML
  (a basic or literal string, a number, `inf`, `nan`, a boolean, an RFC 3339
  date/time, an array or inline-table opener), else INI when every assignment
  is an INI one, else no TOML/INI (and the YAML checks run). That reproduces
  upstream's flavor vectors (`x = "1"` is TOML, `x = hello` INI) but can claim
  text a parser would reject; Tier 1 verifies itself and Tier 2 keeps the
  original retrievable, so a wrong label costs nothing irreversible.
- `isIniAssign` is a linear scanner accepting exactly what upstream's
  `_INI_ASSIGN_RE` matches: its lazy run plus `\s*` backtracks quadratically on
  whitespace-heavy lines.
- INI also refuses Tier 2 around `"""` or `'''`, since its flavor is not
  parser-confirmed.
- The inverse helpers stop once their output would outgrow the text being
  verified, so a marker-shaped line with a huge count, or markers doubling each
  other, never allocates it (upstream expands such input in full).
- Detection reads the detector's line-capped sample (the first 200 of its 500
  lines, each cut to 1000 characters), not the whole text.
- Deferred: Tier 3, the TOML array-of-tables schema fold (it needs a real TOML
  parser), upstream's `paths` fold and its cross-kind lossless probing
  (`_lossless_first`); the log, search, diff and text folds are ported with
  their compressors.

## HTML extractor

A bounded, hand-written stand-in for upstream headroom's HTML extractor
(`headroom/transforms/html_extractor.py`, which runs trafilatura, with its
`content_router.py` wiring and `_DENSE_ELIDE_AFTER` membership, read
2026-10-11 at 976aa71) in `hooks/policy.mjs` as `extractHtml`, reached through
the content router's `html` route (`extract`, then `elide` on the extraction).
It has its own toggle, `html_extractor_enabled`, and its own `html extractor`
table (`pages`, `saved`). It shares the tag lexer `tagAt` (upstream
`tag_protector.rs` `parse_tag_at`) with the tag protector.

Ported verbatim:

- The routing: `html` is extracted, and the dense line elider then runs on the
  extraction (`_DENSE_ELIDE_AFTER` holds HTML; `ELIDE_AFTER` here).
- An empty extraction falls through (upstream #3609): the elider then runs on
  the page as it is, and no block is discarded.
- trafilatura's settings as far as they apply: links and tables kept, images
  and comments dropped, recall over precision, markdown-ish output.

Deviations:

- No trafilatura (a third-party package; the mod takes no dependencies). One
  forward pass skips comments, `<!…>` and `<?…>` declarations and the
  boilerplate or non-text elements `head`, `script`, `style`, `noscript`,
  `template`, `svg`, `math`, `iframe`, `object`, `embed`, `canvas`, `audio`,
  `video`, `picture`, `nav`, `footer`, `aside`, `button`, `select` and
  `textarea` (open tag to the first case-insensitive
  close tag, or to the end when unclosed), and renders the rest: `#` headings,
  `- ` list items, `[text](href)` links (not `#…` or `javascript:`), `| ` table
  cells with one row per line, a line break per block element, whitespace kept
  only inside `<pre>`, and `&amp; &lt; &gt; &quot; &apos; &nbsp;` plus decimal
  and hex references decoded. No main-content scoring and no metadata, so its
  output differs from upstream's and keeps more of the page.
- The original page stays retrievable: the extraction ends with
  `[HTML extracted to text: N characters of markup removed. Retrieve original: hash=H]`
  and the page goes to the `offloaded` store. Upstream's HTML path cannot be
  undone.
- The pass draws on a budget of 4 per character + 4096 (the lexer charges
  every character it scans), and a page that exhausts it passes through; so
  does a page whose extraction plus retrieval line is not shorter.
- Misroute risk: dense grep or log output carrying a doctype, an `<html>` tag
  or 3 structural tags can be labelled `html` (the HTML branch precedes search
  and log, as on upstream's regex path), and the extractor would then strip
  markup-looking text from it. The original stays retrievable.

## Log compressor

A port of upstream headroom's log compressor
(`crates/headroom-core/src/transforms/log_compressor.rs` `compress_with_store`
with `LogCompressorConfig::default()`, the Rust port of
`headroom/transforms/log_compressor.py`) and of the `log` kind of
`headroom/transforms/lossless_compaction.py` `compact_lossless`, read
2026-10-11 at 976aa71, into `hooks/policy.mjs` as `compressLog` and `foldLog`,
reached through the content router's `build` route (`log`, `logfold`, `elide`).
It has its own toggle, `log_compressor_enabled`, and its own `logs` table
(`texts`, `saved`); the fold counts there too.

Ported verbatim:

- The defaults: at most 10 errors and 10 fails (the first, the last, then the
  best by score), 3 context lines around every kept line, 5 deduplicated
  warnings, the first 3 stack traces at 20 lines each, every summary line, an
  adaptive total of 10 to 100 lines (`computeOptimalK`), and logs under 50
  lines (`split("\n")`, a trailing empty element counted) left alone.
- The level classifier's exact-casing words (ERROR, error, Error, FATAL, fatal,
  Fatal, CRITICAL, critical; FAIL(ED), fail(ed), Fail(ed); WARN(ING),
  warn(ing), Warn(ing); INFO/info/Info; DEBUG/debug/Debug; TRACE/trace/Trace),
  the leftmost-longest match with its ASCII word-boundary filter, and the level
  of the first valid match by position (`WARN: error` is a warning).
- The stack-trace state machine with all seven flavors (Python traceback, JS,
  Java, Rust error, Rust backtrace, Go panic, .NET), their opener and
  terminator rules, the 20-line cap that re-opens a continuing trace, and the
  runtime-frame collapse of an oversized trace (`RUNTIME_FRAME_PREFIXES` and
  `RUNTIME_FRAME_MARKERS`, 3 head frames, 5 app frames,
  `      [... N frames collapsed]` scored 0.8).
- The summary-line rules, the pytest `short test summary info` scan (CRLF
  tolerant) and its cap reserve (each section's totals line and the first `E `
  line), the scores (error and fail 1.0, warn 0.5, info and unknown 0.1, debug
  0.05, trace 0.02, +0.3 in a trace, +0.4 on a summary line, at most 1), the
  warning dedupe key (the text before the first `:` or `=` verbatim, then
  digits → N, `0x…` → ADDR, `/…/` → /PATH/, in that order), the cap order
  (reserved, score, short-summary entry, line) and the
  `[N lines omitted: E ERROR, F FAIL, W WARN, I INFO; omitted: …]` line.
- The marker descriptor `summarize_omitted` (`: K file(s), M exception
type(s) (A, B, …)`, at most 5 names, labels and files a kept line shows
  left out).
- The fold: ANSI colour codes dropped one-way, then `collapse_runs`, kept only
  when `expand_runs` gives the de-coloured text back and the result is shorter.

Deviations:

- The retrieval line is always added, `[N lines compressed to M<descriptor>.
Retrieve original: hash=H]`, with no `min_compression_ratio_for_ccr` (0.5)
  gate and "Retrieve original" in place of "Retrieve more"; the hash is
  `contentHash`. A result that is not shorter, marker included, declines.
- The simhash diversity count of `computeOptimalK` is charged to a budget of 4
  per character + 4096 comparisons; an exhausted budget keeps 100 lines (many
  distinct lines: high diversity, where upstream lands on the maximum too).
- The format detector is not ported: it only labels the result.
- JS `\d`, `\w` and `\b` are ASCII-only where Rust's are Unicode (the dedupe key,
  the level words' boundaries already were ASCII upstream).

Wiring: the `build` route runs `log` (adopted only through `overFold`: at most
95% of `foldLog`'s length when the fold shrinks the text), then `logfold` (only
while the text is still the route's input), then `elide`. An adopted lossy log
is handed on to the elider (`ELIDE_AFTER`); an adopted fold ends the route.
Read output, line-numbered text and text holding a tag span are left whole.

## Search compressor

A port of upstream headroom's search compressor
(`crates/headroom-core/src/transforms/search_compressor.rs`
`compress_with_store` with `SearchCompressorConfig::default()`, the Rust port of
`headroom/transforms/search_compressor.py`, scoring through
`crates/headroom-core/src/signals/keyword_detector.rs` in its Search context)
and of the `search` kind of `lossless_compaction.py` `compact_lossless`
(`search_heading`, `search_dir_heading` and their inverses), read 2026-10-11 at
976aa71, into `hooks/policy.mjs` as `compressSearch` and `foldSearch`, reached
through the `search` route (`search`, `searchfold`, `elide`). It has its own
toggle, `search_compressor_enabled`, and its own `search` table (`texts`,
`saved`); the fold counts there too.

Ported verbatim:

- The three-tier line parser (`parse_match_line`, `scan_marker`): the colon
  tier, the dash tier that walks past a `-N-` only on path evidence
  (`last_segment_has_extension`, `path_continues`, `has_extension_dot`), the
  permissive tier, the Windows drive prefix, the adjacent-separator rejection
  and the dash tier's hand-off when its confirmed boundary precedes the colon
  marker. Lines that do not parse are dropped (`lines_unparsed`).
- The scores: +0.3 per query context word (longer than 2 characters) found in
  the lowercased line; +0.5 for an error word, +0.3 for an importance word
  (whichever whole word comes first, case-insensitive), else +0.4 for a warning
  word; at most 1.
- The selection: files by total score (stable), at most 15; an adaptive total
  of 5 to 30 matches (`computeOptimalK` over `file:line:content`); per file the
  first, the last, then the best by (score, line), at most 5 and unique by
  (line, content), back in line order; `file:line:content` rows in path order
  with `[... and N more matches in FILE]`.
- The fold: the file-heading and directory-heading forms, each kept only when
  its inverse gives the text back exactly, the smaller one when shorter;
  timestamped log rows are never grep rows (`_TIMESTAMP_ROW_RE`).

Deviations:

- The retrieval line is always added, `[N matches compressed to M. Retrieve
original: hash=H]`, with no `min_matches_for_ccr` (10) or ratio (0.8) gate and
  "Retrieve original" in place of "Retrieve more"; the hash is `contentHash`.
- Every candidate-marker scan of one text (the dash tier's path checks) draws on
  one budget of 4 per character + 4096; an exhausted budget declines the text
  (upstream rescans a line per marker, quadratic on hostile input). The simhash
  count has its own budget, as for the log compressor.
- Context words are lowercased with `toLowerCase` (upstream: ASCII lowercase),
  deduped newest first and capped so substring matching stays under about 16M
  character comparisons (`contextWords`); CJK query bigrams are not added.
- A line number beyond `Number.MAX_SAFE_INTEGER` leaves its line unparsed
  (upstream: u64). Paths sort by UTF-16 code units (upstream: UTF-8 bytes), and
  scores sum in doubles where upstream sums f32.
- Lines are matched with `[^\n]*` where Python's fold regexes use `.`, which in
  JS would also stop at a `\r`.

Wiring: the `search` route runs `search` (adopted only through `overFold`
against `foldSearch`), `searchfold` (only on the route's input), then `elide`.
An adopted search rewrite is handed on to the elider; an adopted fold ends the
route. Read output, line-numbered text and tagged text are left whole. Claude
Code's Grep tool is compressed like any other (upstream's `DEFAULT_EXCLUDE_TOOLS`
is not adopted; see `## Content router`).

## Diff compressor

A port of upstream headroom's diff compressor
(`crates/headroom-core/src/transforms/diff_compressor.rs` `compress_with_store`
with `DiffCompressorConfig::default()`) and of the `diff` kind of
`lossless_compaction.py` `compact_lossless` (`diff_strip_index`), read
2026-10-11 at 976aa71, into `hooks/policy.mjs` as `compressDiff` and
`foldDiff`, reached through the `diff` route (`diff`, `difffold`, `elide`). It
has its own toggle, `diff_compressor_enabled`, and its own `diff` table
(`texts`, `saved`); the index strip counts there too.

Ported verbatim:

- The gates: under 50 lines (`min_lines_for_ccr`, which gates the whole
  compression) or without a `diff --git`, `diff --combined` or `diff --cc`
  header the text is left alone; `split("\n")` keeps a `\r` on its line.
- The parser: pre-diff lines kept verbatim; mode, rename, similarity, copy and
  binary lines setting their flags (and falling through, as upstream); `---`
  and `+++` lines taken whole; `@@`, `@@@` and `@@@@` hunk headers (5 or more
  `@` fall through as content); `+`/`-` lines counted, every hunk line kept;
  other header lines outside a hunk (`index`, `old mode`, `new mode`) dropped.
- The caps: past 20 files the most-changed 20, in that order; past 10 hunks the
  first, the last and the 8 best middle hunks by score (stable), re-sorted by
  their `+N`; 2 context lines around each change, every `\` line kept, a hunk
  without changes keeping its first 2 lines. The `+A -D` totals count the lines
  of dropped hunks too.
- The scores (`score_hunks`): min(0.3, changes × 0.03), +0.2 per query context
  word, +0.3 once for `PRIORITY_PATTERNS_DIFF`, at most 1.
- The output: `new file mode 100644` / `deleted file mode 100644`, `Binary files
differ`, and the `[N files changed, +A -D lines, H hunks omitted]` footer.
- The fold: `index <sha>..<sha> [mode]` lines dropped when that shortens the
  text, with no inverse check; the router only folds diff-labelled text.

Deviations:

- Upstream always returns the normalised output and adds `Retrieve full diff:
hash=…` only when the output has under 80% of the lines, so a weaker
  compression is lossy with no retrieval. Here a result is returned only when it
  is strictly shorter, marker included, and it always ends with `[N lines
compressed to M. Retrieve original: hash=H]` (M counts the lines before the
  marker); the hash is `contentHash`.
- Hunks are scored only when a surviving file has more than 10 of them: the
  score is read nowhere else, so no output changes.
- Context words are deduped and capped (`contextWords`; upstream counts a
  repeated word twice and matches every word), and CJK query bigrams are not
  added.
- The footer counts every file and line, not only the 20 the cap keeps, and
  ends with `; N files omitted: <b-paths>` (at most `DIFF_OMITTED_NAMES`, 10,
  names, then `…`) when the cap dropped files (user decision; upstream's footer
  counts only the kept files and records the dropped names in its stats alone).
- The `diff --git a/(.+) b/(.+)$` header test is hand-written (the regex would
  backtrack quadratically on a long line with many ` b/`).

Wiring: the `diff` route runs `diff` (adopted only through `overFold` against
`foldDiff`), `difffold` (only on the route's input), then `elide`. A diff
rewrite or an index strip ends the route: DIFF is not in upstream's
`_DENSE_ELIDE_AFTER`. The lossy diff breaks `git apply` (stale hunk counts,
normalised mode and binary lines), as upstream; the retrieval line restores the
exact diff.

## Text crusher

A port of upstream headroom's TextCrusher
(`crates/headroom-core/src/transforms/text_crusher/crusher.rs` and `config.rs`,
the ASCII path, `TextCrusherConfig::default()`, wrapped by
`headroom/transforms/text_crusher.py`) and of the `text` kind of
`lossless_compaction.py` `compact_lossless`, read 2026-10-11 at 976aa71, into
`hooks/policy.mjs` as `crushText` and `foldText`, reached through the `text`
route (`split`, `textcrush`, `textfold`, `elide`). It stands in for upstream's
Kompress (ML), which the mod cannot run. It has its own toggle,
`text_crusher_enabled`, and its own `text crusher` table (`texts`, `saved`);
the fold counts there too.

Gates (user decisions, deviations from upstream): the lossy crusher and the
relevance split run only on prose (`isProse`: at least half the non-empty lines
hold a sentence end, `.`, `!` or `?` before whitespace or the line end), since
upstream's one-segment-per-line fallback would halve a Glob, `find`, `ls` or
`git log --oneline` listing the router labels `text`; and never on an `Agent` or
`Task` result (`REPORT_TOOLS`), whose hand-back report ends with the agentId the
model resumes it with. The lossless `textfold` and the elider still run on both.

Ported verbatim:

- The segmentation (`split_segments_ascii`): each trimmed line, cut after `.`,
  `!` or `?` and the whitespace that follows; fewer than 6 segments pass.
- The tokens (`tokens_ascii`: alphanumeric or `_` runs, lowercased), the plain
  BM25 relevance (`bm25Scores`, the shared core of `relevanceScores`), the score
  `1.0 × (i+1)/n + 2.0 × relevance + 1.5 × salient/(words+1)`, × 0.25 under 12
  characters, and `is_salient` (an ASCII digit, an error/status keyword, 2+
  letters all uppercase, a dotted identifier).
- The selection: best first (ties by position), kept until half the
  characters are (`target_ratio` 0.5, checked before each candidate), skipping a
  candidate whose 3-token shingles are 85% covered by kept ones; the kept
  segments in order, joined by `\n`.
- The fold: `collapse_runs`, kept only when `expand_runs` inverts it and it is
  shorter.

Deviations:

- Text holding a CJK character (`TEXT_CJK_RE`, exactly upstream's `is_cjk`
  ranges) declines: upstream's ICU segmentation path is not ported.
- Eligibility: every `text`-labelled result of 300+ characters (the router's
  floor, above upstream `prose_field`'s 256) that is not Read output,
  line-numbered or tagged, subagent reports and markdown output included.
  Upstream reaches TextCrusher only past a 50,000-token Kompress gate (opt-in);
  here it stands in for Kompress wherever Kompress would run. No tool-name
  exception for `Agent` reports (upstream runs Kompress on them too).
- The kept text ends with the mod's own `[Text crushed: K of N segments kept.
Retrieve original: hash=H]`; a result that is not shorter declines.
- `target_ratio` is a constant (upstream clamps a per-call value to 0.05–1.0);
  lengths count UTF-16 units where upstream counts UTF-8 bytes; JS `\b` (BM25's
  tokenizer) is ASCII-only.

Wiring: on the `text` route `textcrush` runs after `split` (when the split
declined), adopted only through `overFold` against `foldText`; then `textfold`
(only on the route's input), then `elide`. An adopted crush is handed on to the
elider; an adopted fold ends the route.

Behaviour change (0.8.0): prose tool results of 6+ sentences (Agent hand-back
reports, WebFetch summaries, markdown command output) now reach the model as
about half their characters, without their line breaks and indentation, and
cross-turn dedup indexes that crushed form (a repeated report is crushed the
same way, then folded into a pointer). `text_crusher_enabled: false` restores
the earlier path.

## Relevance split

A port of upstream headroom's prompt-conditioned relevance split
(`headroom/transforms/relevance_split.py` `segment`, `_otsu_threshold`,
`adaptive_threshold`, `plan_relevance_split`, and
`headroom/transforms/content_router.py` `_relevance_split_compress` and
`_json_straddles_segments`), read 2026-10-11 at 976aa71, into
`hooks/policy.mjs` as `splitRelevance`, `segmentRecords`, `adaptiveThreshold`
and `otsuThreshold`. It is the first step of the `text` route. It has its own
toggle, `relevance_split_enabled`, and its own `relevance split` table
(`texts`, `saved`).

Ported verbatim:

- `segment(window=8, max_chars=1200)`: a lossless partition into blank-line
  blocks packed into windows of 8 lines (indented continuations held past
  that) and 1200 characters, a single longer line whole.
- The scores (plain BM25 against the conversation query), the cut
  (`adaptive_threshold` with the 0.25 floor: the floor when fewer than 2
  distinct scores, else the Otsu midpoint, at least the floor), KEEP from the
  cut up, consecutive records of one disposition merged into runs.
- An empty query, a single record or no DROP run means no split; the result is
  adopted only when it beats plain whole-block lossless compaction.

Deviations:

- Routed on `text` only (user decision); upstream splits LOG and SEARCH output,
  where the log and search compressors run here. Because of that the split has
  no `kind`: the fold it uses is `foldText`.
- DROP runs become `...[N low-relevance line(s) elided]...` with one final
  `[N low-relevance line(s) in R run(s) elided. Retrieve original: hash=H]`
  line and the original stored: upstream's CCR-mode disposition
  (`relevance_split.py` docstring), since the mod always has retrieval. Upstream
  hands the DROP tail to Kompress.
- A DROP run holding an `ERROR_KEYWORDS` entry (lowercased substring, as the
  crusher tests rows) is kept whole, and a split with no KEEP run left declines
  (user decision; upstream would emit DROP markers only).
- `foldText` belongs to `text_crusher_enabled`: KEEP runs are folded, and the
  adoption baseline is the folded whole text, only while that lever is on; with
  it off the split never calls `foldText`, KEEP runs stay raw and the baseline
  is the raw text (user decision).
- The JSON straddle guard declines when any top-level balanced `[`/`{` span
  crosses a record cut, found by `noJsonSpans`' budgeted walk (an exhausted
  budget declines); upstream protects only spans that parse as JSON documents
  or record arrays. One-line spans (JSONL) never straddle.
- The query is `crushQuery` (the last 5 user texts and recent tool inputs), not
  `build_relevance_query`'s prompt plus the triggering call's arguments; the
  scorer is BM25 only (no embedding or hybrid tier), and there is no
  `max_records` cap.
- Lines split on `\n` only (Python's `splitlines` also splits on `\r`, `\v`,
  `\f`, `\x1c`–`\x1e`, `\x85`, U+2028 and U+2029); 9-decimal rounding in the
  distinct-score check uses `Math.round`.

Wiring: `split` runs first on the `text` route, ahead of `textcrush`, as
upstream's split returns before its strategy dispatch; a split rewrite ends the
route (no crush, no elision), and when it declines the text crusher, its fold
and the elider run as without it. It needs a query: `wantsQuery` fetches the
transcript for it, and with no query it declines.

## Tag protector

A mask-free port of upstream headroom's tag protector
(`crates/headroom-core/src/transforms/tag_protector.rs` `identify_spans` and
`parse_tag_at` in block mode, `compress_tagged_content=false`, read 2026-10-11
at 976aa71) into `hooks/policy.mjs` as `tagSpans`, sharing the lexer `tagAt`
with the HTML extractor. It has its own toggle, `tag_protector_enabled`, no
`compressOn` term and no `/headroom` table: it saves nothing itself, it only
narrows what the compression levers rewrite.

Ported verbatim:

- The HTML5 element set (`HTML5_TAGS`, all 116 names of `HTML5_TAGS` in
  `tag_protector.rs`), matched case-insensitively; every other name is a custom
  tag (`is_known_html_tag`).
- `parse_tag_at`: a name starts with an ASCII letter or `_` and continues with
  letters, digits, `_`, `-`, `.` and `:`; a close tag allows whitespace before
  `>`; an open tag's attributes run to the first `>` outside quotes, an
  unterminated quote makes no tag, and `/` marks it self-closing until
  whitespace or a quoted value follows.
- `identify_spans` in block mode: a self-closing custom tag is a span; a custom
  close matches the top-most open of its name (`rposition`), drops the opens
  above it and the spans inside it, and records the whole block; an orphan
  close or an unmatched open is never protected.

Deviations:

- Mask-free: no placeholders, no `restore_tags`, no salted prefixes. Upstream
  protects only around its ML text compressors, which the mod does not have;
  here every compression lever honours the spans on its own terms (all
  mod-side):
  - the SmartCrusher runs a JSON text holding a span without the lossy stage
    (lossless compaction may still re-encode it, every string verbatim in a
    cell; no row or item is dropped);
  - the dense line elider never treats a line a span touches as dense;
  - cross-turn dedup never starts a fold on a tagged line and ends a run before
    one, but indexes tagged lines like any other;
  - the config compressor, the HTML extractor, the log, search and diff
    compressors, the text crusher and the relevance split decline a text
    holding a span;
  - after an HTML extraction `shrink` recomputes the spans on the extracted
    text before the elider runs, so a custom tag the entity decoding produced
    (`&lt;system-reminder&gt;`) is guarded like any other; a null there returns
    the extraction unelided.
- A work budget: the characters the lexer scans and every stack entry a close
  examines share one budget of 4 per character + 4096. Exhaustion returns null:
  the text is unprotectable, and every lever passes it through unchanged (dedup
  only indexes it). Upstream has the same unbounded weakness (it re-parses after
  every `<` that is no tag and walks the whole stack per close), so many custom
  opens followed by many non-matching closes would go quadratic.
- The content of an HTML5 `<svg>` or `<math>` element, up to its first
  case-insensitive close tag (an unclosed one skips nothing), is not scanned: SVG and MathML children (`path`,
  `g`, `mi`, …) are no workflow tags, and without this the elider would stop
  eliding SVG path data.
- The spans inside a matched block are dropped by popping the tail of the
  sorted span list (amortised linear) where upstream filters the whole list.
- Vocabulary as upstream: every non-HTML5 name counts, so XML, JSX/TSX
  components and Vue templates are protected too, and re-reads of such files
  fold and elide less. `tag_protector_enabled: false` restores the levers'
  earlier behaviour.
- Cost: one budgeted scan per distinct text holding a `<` (the last scan is
  reused when dedup receives the route's unchanged final text), two for an HTML
  page the extractor rewrote.

## Content router

A port of upstream headroom's content detection into `hooks/policy.mjs` as
`detectContentType`: the branch heuristics of
`headroom/transforms/content_detector.py`, the category set and branch order
of `crates/headroom-core/src/transforms/content_detector.rs`, and
`_TIMESTAMP_ROW_RE` from `headroom/transforms/lossless_compaction.py`, read
2026-10-11 at 976aa71. It labels each unprotected tool-result text with one
tag: `json_array`, `diff`, `html`, `tabular` (git status), `search`, `build`,
`structured_config`, `source_code` or `text`.

Ported verbatim:

- The branch order and gates: empty → `text`; JSON; diff (≥ 0.7); HTML
  (≥ 0.7); git status; search (≥ 0.6); log (≥ 0.5); structured config; code
  (≥ 0.5); else `text`.
- The line and character windows: diff over the first 500 lines, HTML over the
  first 3000 characters, search over the first 100 lines, log over the first
  200 lines, code over the first 100 lines.
- Every regex and threshold of the ported branches: `_TIMESTAMP_ROW_RE`, the
  path-shape guard (no `<`, `>` or `=` before the line number), grep context
  lines (`path-N-` whose path holds a `/` or `.`, and `path:N-`), the ≥ 2-match
  search floor and its 0.3 ratio, all 24 log patterns and their 0.1 ratio, the
  8-language code patterns (anchored at the line start, as `re.match` is) and
  the best score of 3, the JSON wrapper bulk fraction 0.6, the concatenated
  ≥ 2-objects rule, and the git-status first lines, headings and entry regex.
- The confidence formulas, in upstream operand order, so IEEE borderline cases
  match: one diff header and no change line gives exactly 0.7, which passes,
  and a search ratio of 1/3 gives 0.6, which passes.
- The type tags (upstream `ContentType` values).

Deviations from upstream:

- Rust's category set plus Python's structured-config branch (its tag
  `structured_config` has no Rust counterpart). Its YAML/TOML/INI flavor comes
  from line-level checks in place of `tomllib` and `configparser` (see
  `## Config compressor`), so it can claim text upstream's parsers would
  reject; it only takes text that would otherwise be code or plain text, whose
  route was the elider alone. Python's tabular (markdown table, CSV/TSV) and
  fixed-width branches stay omitted: they too only take such text, and the
  newer tabular branch disagrees with upstream's own parity fixtures (it reads
  the JavaScript fixture as `tabular`).
- JSON follows Python, not Rust: objects, wrapped payloads and concatenated
  objects count, not only arrays. The parity fixture `{"foo": "bar"}`
  therefore reads `json_array` (Rust records `text`).
- `raw_decode` is emulated by the span walker `scanFrom` plus `JSON.parse`. A
  non-`{` value ends the concatenated check, where upstream decodes it and then
  rejects the run; the verdict differs only when that value would hit the
  recursion limit.
- `JSON.parse` rejects `NaN`/`Infinity`, which Python's `json` accepts. A
  `JSON.parse` failure other than a `SyntaxError` counts as upstream's
  `RecursionError` (not JSON).
- JS `\w`, `\d` and `\b` are ASCII-only where Python's are Unicode; `\s` and
  `trim()` differ from Python's on a few exotic code points.
- Lengths (the 3000-character HTML sample, the bulk fraction) count UTF-16
  units, where upstream counts code points.
- Each sampled line is cut to `DETECT_MAX_LINE_CHARS` (1000) before the diff,
  search, log and code checks: the PHP and C# stack-trace patterns backtrack
  quadratically, and detection runs synchronously on every appended result. A
  signal beyond that column of a line goes unseen.
- A text whose first line carries an `N\t` line number (Read output, `cat -n`) is never labelled `html`: it is a
  file's source, and extracting it would leave the Edit tool nothing to match.
- The detector returns only the tag: no confidence and no metadata (language,
  counts), since nothing consumes them.

Routing: a light port of `headroom/transforms/content_router.py`
(`_strategy_from_detection`, `_DENSE_ELIDE_AFTER`, the git-status early return
and the passthrough-fallback elision, read 2026-10-11 at 976aa71). The
module-private `ROUTES` table maps each tag to its ordered steps:
`json_array` runs `crush` then `elide`, `structured_config` runs `config` then
`elide`, `html` runs `extract` then `elide`, `build` runs `log`, `logfold`
then `elide`, `search` runs `search`, `searchfold` then `elide`, `diff` runs
`diff`, `difffold` then `elide`, `text` runs `split`, `textcrush`, `textfold`
then `elide`, and `tabular` and `source_code` run `elide` alone.
`rewriteRow`'s `shrink` detects once per unprotected text and runs that type's
steps in order, skipping a step whose lever is off; the first step that
rewrites wins, except that a step in `ELIDE_AFTER` (`extract`, `log`, `search`
and `textcrush`, upstream's `_DENSE_ELIDE_AFTER` HTML, LOG, SEARCH and TEXT
members) hands its rewrite on to the next step. Any other rewrite ends the
route: the crusher, the config compressor, a diff rewrite, every fold and a
relevance split, as upstream returns a kept fold and a split before its
elision point and leaves SMART_CRUSHER, CONFIG and DIFF out of
`_DENSE_ELIDE_AFTER`; the elider still runs as the fallback when every step
before it declined. A lossy step sits before its kind's lossless fold because
it has to beat that fold, which is the floor: `overFold` adopts it only at
most `(1 - LOSSY_MIN_EXTRA_SAVINGS)` (0.95) of the fold's length when the fold
shrinks the text (upstream's `lossless_then_lossy` gate,
`_DEFAULT_LOSSY_MIN_EXTRA_SAVINGS`). A fold is the fallback for a lossy step
that declined or lost to it, never a post-processor of an adopted lossy
result, which goes straight to `elide`: a fold step runs only while the text is
still the route's input (`cur === text`). Detection runs only while a lever some
route runs ahead of the elider is on (every compression lever but dedup and the
elider), so a dedup-only or elide-only configuration pays nothing, and only on
a text of at least `ROUTE_MIN_CHARS` (300, the router-wide floor; the new
steps' upstream floors are lower, but under 300 characters a retrieval line
would eat most of any saving), since a shorter one is passed through whatever
its label. The router compressors (log, search, diff, text crusher, relevance
split) leave Read output and line-numbered (`N\t`, `cat -n`) text whole, as the
HTML extractor does and dedup only indexes it, so the Edit tool can still match
it, and decline a text holding a tag span. Dedup (`dedupBlock`) then runs over
every type's final text, unchanged.

Routing deviations from upstream:

- A JSON text the crusher declined is still elided. Upstream skips elision
  after any SmartCrusher attempt (`_DENSE_ELIDE_AFTER` leaves it out).
- Git status and source code get the elider, as upstream does where a type's
  compressor is unavailable (the passthrough fallback). Upstream keeps git
  status verbatim; here the elider's tab guard already leaves every
  tab-indented entry line whole, and a compound output such as
  `git status; cat app.min.js` keeps its elision.
- Dedup stays type-agnostic.
- The fold floor: upstream's default (`lossless_then_lossy = False`) ends the
  route on any fold that shrinks the text, under which the ported compressors
  would almost never run (every `git diff` has `index` lines, two consecutive
  grep rows of one file fold, a log with one repeated line folds). The router
  uses upstream's opt-in `lossless_then_lossy` gate with its default 0.05
  instead; the lossy step runs on the raw text, not on the folded text as
  upstream's Kompress layer does (the per-kind parsers need the raw shape), and
  the diff route uses the gate too (upstream keeps Kompress off diffs; the diff
  compressor is upstream's own DIFF strategy and never emits `index` lines).
- Upstream's `DEFAULT_EXCLUDE_TOOLS` (`headroom/config.py`: Read, Glob, Grep,
  Write, Edit, WebSearch, WebFetch, Skill, … never lossily compressed) is not
  adopted: every lever rewrites results of any tool except error and protected
  rows, and the router compressors and the HTML extractor also leave Read and
  line-numbered text whole. Adopting the list would leave the search
  compressor idle on Claude Code's Grep tool.
- The relevance split routes only on `text` (user decision), ahead of the text
  crusher and folding with `foldText`, never on `build` or `search` where
  upstream runs it; it keeps any record run holding an `ERROR_KEYWORDS` line
  and declines when no KEEP run would remain (see `## Relevance split`).
- A light router: no `is_mixed_content` / MIXED, no Magika or native detector,
  no `_strip_detection_envelope`, no embedded-JSON splice, no cross-kind
  lossless probing (`_lossless_first`: each step tries only its own kind's
  fold, and the `paths`, `html`, `tabular`, `source_code` and `json_array`
  folds are not ported), no Kompress (TextCrusher stands in for it on prose) or
  LOG fallback chains, no TOIN recording, and no `normalize_concatenated_json`
  (the crusher still takes only one whole JSON document).

Decisions:

- No userConfig toggle. The router has no behaviour of its own; which text a
  lever sees is governed by that lever's toggle and documented per lever. The
  router is infrastructure, and each future compressor brings its own toggle;
  `.claude/rules/plugin-userconfig.md` lists it under its deliberate no-toggle
  exceptions.
- Per-compressor `/headroom` tables exist (`compaction`, `config`, …), but
  per-type label counts stay omitted: a label alone saves nothing.

Adding a compressor: name a new `RouteStep`, add its case in `rewriteRow`'s
`shrink`, a `Levers` flag fed by its own `*_enabled` toggle in `register.ts`
(plus its term in `compressOn`), a `RowRewrite` accumulator and `/headroom`
table if it reports savings, and its step in the `ROUTES` entries of the types
it fits, deciding whether `elide` still runs on its rewrite (put the step in
`ELIDE_AFTER`, as upstream's `_DENSE_ELIDE_AFTER` does). A lossless fold is a
`RouteStep` of its own that ends the route, and its branch requires
`cur === text`, so it runs only on the route's input and never on a handed-on
(lossy) rewrite; a lossy step that has a fold sits before it and gates on
`overFold(r, foldX(cur))`. A step that reads the query must also be added to
`wantsQuery`'s lever term, or its rows are rewritten without one.

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
  `registered twice without a matcher`. The subagent error cleanup and a
  finished agent's dedup-corpus reset therefore share the one `turn.complete`
  hook with the storage write, registered while `storage_enabled`,
  `subagent_effort_routing_enabled` or `cross_turn_dedup_enabled` is on.
  `session.compact` has one matcher-less hook (registered while
  `cross_turn_dedup_enabled` is on) that resets the dedup corpus. `tool.call`
  likewise has one hook, which observes effort errors and answers
  `headroom_retrieve`, registered while effort routing or any compression
  lever is on. `session.append` has exactly one hook, with the matcher
  `{ door: "tool-result" }`, which runs every compression lever, registered
  while any of them is on.
- Live-run on 2.1.296 (headless `claude -p --plugin-dir … --setting-sources project`,
  a stdio MCP test server via `--mcp-config`, stream-json transcript as evidence):
  - Core resolves an MCP tool's `tool.call` to `{ ref, result, text }` where
    `result` is the content-block array itself (`[{ type: "text", text }]`),
    not `{ content: [...] }` (that is `$.mcp.call`'s shape). The typings leave
    an MCP tool's `result` as `unknown`.
  - The model's own calls carry `next.origin` `{ plugin: "engine", tier: "core" }`.
  - A hook-rewritten Bash `{ result }` and MCP content array pass core's
    validation and reach the model as the crushed JSON (200 rows → 15 + the CCR
    sentinel).
  - `$.tool.register` resolves to `mcp__inline-headroom__headroom_retrieve`; the
    tool is deferred (the model loads it through ToolSearch), its call reaches
    the matcher-less `tool.call` hook, and the `{ result: string }` answer
    reaches the model as text.
  - `headroom_retrieve` raises no permission prompt: the hook answers before
    core's permission step runs (`--permission-mode default` without an allow
    rule records no denial).
- Read from the typings (`claude-code.d.ts`), not live-run:
  - `tool.call` resolves to one of three `ToolCallResult` variants: `{ deny }`,
    an answered `{ result, context?, ref?, text? }`, or
    `{ isError: true, result, text?, ref?, context? }`.
  - Core validates a hook's own `{ result }` against the tool's output schema
    and maps it for the model with the tool's own mapper; `ref` and `text` are
    absent on it. `context` (`readonly string[]`, other hooks' reminder text) is
    "kept whole from `next`", but the typings do not say core restores it on a
    hook's own `{ result }`. The mod answers only `headroom_retrieve` with its
    own `{ result }`; it rewrites tool results at `session.append` instead.
  - The Bash record has `stdout`, `stderr`, `interrupted`, `isImage?`,
    `backgroundTaskId?`, `timedOutAfterMs?` (set when the command hit its
    timeout and was backgrounded), `rawOutputPath?`, `persistedOutputPath?` and
    `structuredContent?`. Each case these fields flag renders a tool_result
    text that is not one JSON document, so the crusher's whole-document parse
    at `session.append` rejects it.
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
  `claude-code/testing`). `clock.advance(ms)` fires a module's `$.clock.every`
  periods exactly on the boundary (`advance(9_999)` fires none of a 10 s
  period, a further `advance(1)` fires one). A refresh tick fetches through the
  pane's render, so a test that counts tick fetches mounts the pane.
- Live-run on 2.1.296 for the earlier levers (headless `claude -p`, an
  interactive session in tmux, a `claude --bg` session, a throwaway probe mod;
  evidence: `--debug-file` logs and, for effort, the `/v1/messages` request
  bodies through a local pass-through proxy):
  - `$.mcp.connect("storage")` connects from the mod by the bare key.
  - `structuredContent` is not forwarded for a tool without `outputSchema`
    (the storage tools have none): `callStorage` reads the JSON text block.
  - The storage permission rules under `## Storage server`.
  - `$.clock.every` started in `command.run`, or in `ui.render` after a hot
    reload, keeps firing with that hook's `$` after the hook returned.
  - The `ui.close` hook (matcher `{ id }`) runs on Esc and on Ctrl+X X, and the
    refresh stops.
  - A file change under `--plugin-dir` hot-reloads the module with the pane
    still open; the first redraw re-arms the refresh.
  - Agent-tool subagents raise `turn.step`, `tool.call` and `turn.complete`
    with one stable `agentId`, and `index` restarts at 0 per agent.
    `turn.complete` fires with `reason: "aborted"` for a background agent
    stopped with TaskStop.
  - Core sends the lowered `effort` (`output_config.effort`) for main-loop and
    subagent steps.
  - A `claude --bg` session's main loop carries no `agentId`.
  - The built-in `cc-plugin-sec-default` skips every user-tier hook on
    `prompt.compose`, `prompt.section` and `prompt.context` (debug log:
    `prompt.compose bypassed by cc-plugin-sec-default (tier user)`), and
    `prompt.compose` is gone from the 2.1.296 typings. The cache aligner's
    volatile list therefore stays empty for an installed plugin; the pane says
    `unavailable` while no `prompt.compose` reached the module (`composeSeen`).
    Its cache-drop counting reads `turn.step` usage and still works.
- Live-run on 2.1.296 for the compression levers (2026-10-11, a throwaway probe
  mod with a `session.append` `{ door: "tool-result" }` hook, headless
  `claude -p … --plugin-dir <probe> --setting-sources project --debug-file …`;
  evidence: the probe's debug lines and the stream-json transcript):
  - `claude plugin validate` lists the hook as `session.append{door=tool-result}`,
    separate from the matcher-less `tool.call`.
  - Each tool result is one row: `door: "tool-result"`,
    `origin: { kind: "tool", tool: "<name>" }`, and a `message` of
    `type: "user"`, `role: "user"` whose `content` holds one
    `{ type: "tool_result", tool_use_id, content, is_error? }` block.
    `agentId` is set on subagent rows and absent on main rows.
  - The tool_result `content` per tool: Bash a string of stdout (with
    `is_error: false`); Read a string with unpadded line numbers (`1\t…`); Grep
    in content mode a string (`1:…`); ToolSearch an array of
    `{ type: "tool_reference", tool_name }` blocks; a `$.tool.register` tool's
    `{ result: "…" }` a string; Agent an array holding one text block (the
    framed hand-back report).
  - `$.session.messages()` (or `$.session.messages({ agentId })` for a subagent
    row) called inside the hook resolves to an array with no deadlock; every
    `session.append` settled in 2.1-4.0 ms, `next` and the fetch included.
  - A rewrite through `next({ ...e, message: { ...e.message, content } })` is
    stored and read by the model, for main and subagent rows alike.
  - A `$.tool.register` tool is callable from a general-purpose subagent: the
    subagent loaded it through ToolSearch `select:`, and the module's
    `tool.call` hook answered it with `agentId` set.
  - Every model tool call, in subagents too, carries `next.origin`
    `{ plugin: "engine", tier: "core" }`.
- Test kit: the test's own
  `$.session.append({ message, door, origin, uuid, agentId? })` raises a row
  through the plugin's `session.append` hooks; the kit's bottom stores it with
  the pinned blocks put back and resolves `{ message, uuid }` (the kit tests'
  `appendResult`).

## Not yet live-verified (kit only)

Shipped on kit and typings evidence only. The user-run live check in the PR
moves each confirmed entry into the section above and records any failure here;
delete this heading once it is empty.

- Workflow agents (only Agent-tool subagents were live-run) raise `turn.step`,
  `tool.call` and `turn.complete` with a stable `agentId`.
- An agent's `turn.complete` hook raises its `stats_put` in-frame, so the
  module's `tool.check` allows it without a permission prompt (only main-loop
  writes were live-run).
- A stdio MCP server's tool_result `content` shape at `session.append` (a
  string or a text-block array; both are handled).
- A tool-result row with `is_error: true`.
- Workflow-agent tool-result rows.
- Agent types whose `tools` allowlist names or leaves out `headroom_retrieve`.
- A dedup pointer whose original was compacted away.
- A real compaction's `session.compact` dispatch (`trigger`, `agentId` and the
  `skip` result are read from the typings; the kit raises the event with
  hand-built input): the dedup corpus reset after `/compact` or an auto-compact.
- The `origin.tool` of a plugin-registered tool's row at `session.append` (the
  protected-row check matches `headroom_retrieve` by name in any namespace to
  stay safe either way).

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
`/headroom` does not measure. Its own `subagents` row lives in memory only;
its steps and clamps also go into the persisted `steps` and `clamped` columns
(no schema change), so the storage rows count main-loop and subagent steps
while the `session` row stays main-loop. An agent's `turn.complete` writes the
pending totals too, so a background agent's steps need no main-loop turn.

## Releases

Never use `claude plugin tag`: its `{name}--v{version}` tag scheme conflicts with
`tag-on-version-bump.yml`, which tags `<name>-<version>` from the `plugin.json`
version.
