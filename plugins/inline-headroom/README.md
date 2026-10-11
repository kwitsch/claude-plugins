# inline-headroom

Headroom-style levers inside Claude Code as a mod: clamp-only effort routing
after successful tool results, a detector-only CacheAligner that flags
volatile system-prompt content and cache-hit drops, and a SmartCrusher,
cross-turn dedup and dense line elider that shrink tool results before the
model reads them (originals retrievable). Ports five levers of
[headroom](https://github.com/headroomlabs-ai/headroom) faithfully to upstream
semantics.

## Install

```
/plugin install inline-headroom@kwitsch-plugins
```

## What it does

| Lever             | Upstream mapping                                           | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effort routing    | headroom effort routing (structural success-vs-error rule) | On a main-loop model step after index 0 whose preceding tool results were all successful, lowers thinking effort to `low`; with `subagent_effort_routing_enabled` on, each subagent and Workflow agent gets the same rule on its own steps, tracked per agent. Clamp-only: never raises effort, never injects one, leaves numeric or absent effort alone. Any tool error or deny since that loop's last step keeps full effort.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CacheAligner      | headroom CacheAligner (detector only)                      | Scans the cacheable `shared` system-prompt sections for UUID, ISO-8601, JWT and 32/40/64-hex values and logs a line whenever the prompt-cache hit ratio drops from at least 60% to below 60% between steps. Never rewrites or reorders the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SmartCrusher      | headroom SmartCrusher (dict-array lossy path)              | Rewrites a successful tool result of any tool whose text (string content or a text block) is one JSON document longer than 800 characters, before the model first reads it: in the main loop, and in subagent and Workflow-agent results while `subagent_compression_enabled` is on. Read results never qualify (their line numbers stop the text from parsing). An array of 5 or more objects keeps at most an adaptive K (3 to 15) rows plus every error row, structural outlier and numeric anomaly: its first and last rows, the rows around change points, top-scored search results, one or two rows per log message cluster, and rows matching the conversation. Arrays of unique entities with no such signal stay whole. An array that lost rows ends with `{"_ccr_dropped":"<<ccr:HASH N_rows_offloaded>>"}`; the `headroom_retrieve` tool returns its original rows. Error results are never rewritten. |
| Cross-turn dedup  | headroom cross_turn_dedup.py                               | Replaces each run of 3 or more lines (40+ characters) in a tool result that already appeared in an earlier tool result of the same conversation (the main loop, or one subagent), verbatim or with every line number shifted by one constant, with a one-line pointer: `[↑nL same as result K: "anchor" hash=H]`, or `[↑nL same as result K +dL: "anchor" hash=H]` for a shifted re-read. K counts that conversation's tool results from 1, the earliest copy is never rewritten, and `headroom_retrieve` with the hash returns the run's exact text. A result that repeats an earlier one in full becomes a single pointer. Error results are never rewritten but count as originals.                                                                                                                                                                                                                             |
| Dense line elider | headroom dense_line_elider.py                              | Shortens each line of 300+ characters with under 6% spaces, no tab and no JSON in it (minified JS/CSS, base64, RSC payloads) to its first 160 and last 80 characters around `...[N chars of dense machine-generated content elided]...`, once such lines add up to 2000+ characters in one result, and ends that result with `[N dense machine-generated line(s) elided. Retrieve original: hash=H]`; `headroom_retrieve` with the hash returns the whole original. It skips text the SmartCrusher rewrote, and error results.                                                                                                                                                                                                                                                                                                                                                                                     |

## Configuration options

All eight options are on by default. For the lever toggles only a literal `false`
disables one; `storage_enabled` is fail-closed, so anything but a literal `true`
turns storage off. Set them via
`/plugin -> installed -> inline-headroom -> Configure options`, or in
`settings.json`:

```json
{
  "pluginConfigs": {
    "inline-headroom": {
      "options": {
        "effort_routing_enabled": true,
        "subagent_effort_routing_enabled": true,
        "cache_aligner_enabled": true,
        "smart_crusher_enabled": true,
        "cross_turn_dedup_enabled": true,
        "dense_line_elider_enabled": true,
        "subagent_compression_enabled": true,
        "storage_enabled": true
      }
    }
  }
}
```

| Option                            | Default | Effect / Value                                                                                                                                                                                                                                    |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort_routing_enabled`          | `true`  | Lower effort to `low` on main-loop steps that only resume after successful tool results.                                                                                                                                                          |
| `subagent_effort_routing_enabled` | `true`  | Apply the same clamp to each subagent and Workflow agent, per agent. Only active while `effort_routing_enabled` is on. Overrides effort set on purpose (agent frontmatter, Agent tool, Workflow); see [Notes & limitations](#notes--limitations). |
| `cache_aligner_enabled`           | `true`  | Flag volatile values in the `shared` system-prompt sections and log prompt-cache hit-ratio drops.                                                                                                                                                 |
| `smart_crusher_enabled`           | `true`  | Compress large JSON arrays in successful tool results of any tool (Read results never qualify); dropped rows stay retrievable with `headroom_retrieve` while the mod is loaded (see [Notes & limitations](#notes--limitations)).                  |
| `cross_turn_dedup_enabled`        | `true`  | Replace a run of 3 or more lines (40+ characters) that repeats an earlier tool result of the same conversation with a one-line pointer; the run stays retrievable with `headroom_retrieve` while the mod is loaded.                               |
| `dense_line_elider_enabled`       | `true`  | Shorten long, nearly space-free lines (minified bundles, base64, RSC payloads) in tool results to their head and tail; the original stays retrievable with `headroom_retrieve` while the mod is loaded.                                           |
| `subagent_compression_enabled`    | `true`  | Also apply the SmartCrusher, cross-turn dedup and the dense line elider to subagent and Workflow-agent tool results. Only active while one of them is on; see [Notes & limitations](#notes--limitations).                                         |
| `storage_enabled`                 | `true`  | Run the host-wide SQLite storage service behind the `storage` MCP tools (see [Storage](#storage)). Fail-closed: only a literal `true` enables it.                                                                                                 |

## `/headroom`

Opens a **Headroom** pane with tables of the stats. Nothing is printed to the
transcript, so the stats never enter the model's context:

```
effort routing     steps clamped
session               12       7
subagents              4       2
today                 40      15
7 days               340     120
30 days             1200     400

cache aligner        hit   drops
session              94%       1
today                91%       2
7 days               91%       4
30 days              90%       9

smart crusher    dropped   saved
session              120   45210

dedup              spans   saved
session                3    2140

line elider        lines   saved
session                2    9870

volatile shared values: unavailable (Claude Code keeps plugins out of the system-prompt hooks)
```

- **Rows:** `session` is this session's counters, kept in memory and redrawn
  live. `subagents` counts this session's subagent and Workflow-agent steps and
  clamps, in memory only (never persisted). `today`, `7 days` and `30 days` are
  rolling windows of local calendar days that include today: totals across all
  sessions on this host, read from [storage](#storage) when the pane opens and
  every 10 s while it stays open. `session`, `today`, `7 days` and `30 days`
  count main-loop steps only. `smart crusher`, `dedup` and `line elider` have
  only a `session` row, held in memory, which counts subagent results too:
  `dropped` counts the array rows this session's crushes replaced with a
  retrieval marker, `spans` the repeated runs replaced with a pointer, `lines`
  the dense lines elided, and each `saved` the characters that lever removed
  from tool results.
- **Tables follow their levers.** `effort routing` is shown only while
  `effort_routing_enabled` is on, and its `subagents` row only while both
  `effort_routing_enabled` and `subagent_effort_routing_enabled` are on.
  `cache aligner` and the volatile list are shown only while
  `cache_aligner_enabled` is on, `smart crusher` only while
  `smart_crusher_enabled` is on, `dedup` only while `cross_turn_dedup_enabled`
  is on, and `line elider` only while `dense_line_elider_enabled` is on. With
  all five levers off the pane says so. Storage is read only while the
  `effort routing` or `cache aligner` table is shown.
- **`hit`** is the cache hit ratio (cache reads / all input tokens). The
  `session` row shows its last step's ratio; the storage rows show the
  token-weighted ratio over their window. It reads `–` while no tokens were
  counted.
- **Storage rows:** they read `…` until their first numbers arrive, and a
  refresh keeps the old numbers on screen until it lands. With storage off
  they read `–` and the pane says so. When a refresh fails, the rows keep their
  last numbers and the pane shows `storage unavailable: <reason>` (`–` if there
  were none). Closing the pane forgets them, so a reopened pane starts at `…`.
- **Volatile shared values** are listed below the tables, for this session
  only, one `<id> <kind> <sample>` line per value (for example
  `env uuid 123e4567-e89…`). The list reads `none` when no shared section
  holds a volatile value.
- When the pane cannot be placed (headless, or a terminal too narrow for it),
  `/headroom` prints the same tables as text instead, read from storage once.

The pane docks beside the transcript in fullscreen at 110+ columns and otherwise sits
above the prompt. It takes the keyboard when the prompt is empty: Esc closes it,
and Ctrl+X then X always does. While it stays open the `session`, `subagents`, `smart crusher`, `dedup` and `line elider` rows redraw whenever the stats change, and the other rows refresh every 10 s.

## Storage

A persistent host-wide SQLite store: a JSON key-value store for inline-headroom
features, and the `stats` table behind the `/headroom` today / 7 days / 30 days
rows. It is the MCP server `storage` (connected as
`plugin:inline-headroom:storage`) with six tools:

| Tool             | What it does                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `kv_get`         | Read the JSON value stored under a key.                                                                  |
| `kv_set`         | Store a JSON value under a key (at most 1 MiB serialized, keys at most 512 chars).                       |
| `kv_delete`      | Delete a key.                                                                                            |
| `stats_put`      | Replace one writer's `/headroom` stats rows (one per local day) and delete every row before a given day. |
| `stats_sum`      | Sum every writer's `/headroom` stats from a given day on.                                                |
| `storage_status` | Report the service pid, protocol and schema version.                                                     |

- **`/headroom` persistence.** At the end of each main-loop turn the mod writes
  its counters to the `stats` table: one row per local day and module load (a
  hot reload starts a new row). Every write deletes the rows older than 30 days.
  An open `/headroom` pane re-reads the storage rows right after that write.
  The turn ends once the write lands (milliseconds; up to about 3 s when it has
  to start the service).
- **No permission prompts.** Claude Code checks a plugin's own MCP calls like
  tool calls; the mod allows its own storage calls itself, so neither the turn's
  write nor the pane's reads ask, in any permission mode. The model's own calls
  to the storage tools still go through your permission rules.
- **One background process per host.** The first tool call, the first
  main-loop turn that ends while `storage_enabled` is on (the `/headroom` write),
  or opening `/headroom` (it reads on open and every 10 s while open) starts a
  detached service process that every session shares. It is the only
  process that opens the database. It exits after 10 idle minutes and starts
  again on the next call.
- **Files** live in the plugin data directory
  (`~/.claude/plugins/data/<plugin-id>/`), which survives plugin updates:
  `storage.db` (plus `storage.db-wal` while the service runs), `storage.sock`
  (an owner-only socket that exists only while the service runs) and
  `service.log` (fatal service errors only).
- **Requires Node >= 22.13** (`node:sqlite`). On an older Node the tools return
  an error that points at `service.log`, and the per-turn `/headroom` write
  and an open `/headroom` pane's refresh retry the start (one `service.log` line
  per attempt, at most once a minute per session); set `storage_enabled` to
  `false` to stop it.
- **Linux, macOS and WSL2 only.** The service listens on a Unix domain socket,
  so on native Windows every storage tool returns an "unsupported" error.
- **Local filesystem only.** SQLite file locks are unreliable on network
  filesystems (NFS/SMB, WSL `/mnt/c`). The plugin data directory is local in
  every supported setup.
- **Other readers are locked out.** While the service runs it holds an
  exclusive lock, so even a read-only `sqlite3 storage.db` reports "database is
  locked". To inspect the database, wait for the idle exit or send SIGTERM to
  the pid that `storage_status` reports.

## Notes & limitations

- **The volatile-value list is unavailable on Claude Code 2.1.296.** Its built-in
  security plugin keeps installed plugins out of the system-prompt hooks, so the
  CacheAligner never sees the prompt and the pane says `unavailable`. Its
  cache-hit drop counting (`hit`, `drops`, the `cache drop` log) still works.

- **Effort switching can cost cache re-writes.** Upstream headroom removed effort
  routing after measuring about $0.0007 saved per mechanical turn against roughly
  $0.011 of cache re-writes per switch. Watch the `drops` count in the `/headroom` pane and
  the `cache drop` log lines; set `effort_routing_enabled` to `false` if clamps
  coincide with drops. Each subagent pays its own re-write on a switch, and
  `drops` and the `cache drop` log follow the main loop only; set
  `subagent_effort_routing_enabled` to `false` to keep subagents at full effort
  while the main loop is still clamped.
- **Subagent effort routing overrides deliberate effort.** The clamp cannot tell
  an effort set in agent frontmatter, the Agent tool `effort` parameter or a
  Workflow `effort` option from a default one; set
  `subagent_effort_routing_enabled` to `false` if agents depend on their
  configured effort.
- **The session rows reset; persisted totals stay.** The `session`,
  `subagents`, `smart crusher`, `dedup` and `line elider` rows live in module
  memory and start over on a hot reload, an options change and `/clear`.
  The today / 7 days / 30 days rows keep their totals, but a turn cut off by a
  reload or a crash before it ends is not persisted.
- **Compression rewrites tool results before the model first reads them.** The
  SmartCrusher, cross-turn dedup and the dense line elider rewrite a tool
  result of any tool (Bash, Grep, WebFetch, MCP tools, an Agent's report, …) as
  it is stored, in the main loop and, while `subagent_compression_enabled` is
  on, in subagents and Workflow agents. The model and the transcript file read
  the compressed form; the screen's tool row and an SDK stream may show the
  original. Error results, `headroom_retrieve` itself and this plugin's own
  storage tools are never rewritten. Read results are never crushed (their line
  numbers stop the text from parsing as JSON), but they are deduplicated and
  elided.
- **A crushed result arrives minified.** When rows are dropped, the whole
  document is re-serialized compactly, with numbers in their shortest form. A
  result that loses no row keeps its exact bytes (upstream minifies it too).
  Use Read for a file's exact text, for example before editing it.
- **Originals are retrievable while the mod is loaded.** One in-memory store,
  shared by all three compression levers, keeps the last 1000 originals
  (crushed arrays, elided blocks and folded runs; at most 16 million characters
  in all); a hot reload, an options change or a new process loses them, and
  `headroom_retrieve` then answers with a denied call naming the hash (re-run
  the tool instead). `headroom_retrieve` never asks for permission: the mod
  answers it before Claude Code's permission check, and it only reads what this
  session's own tool results held. It was live-verified callable from a
  general-purpose subagent, but an agent type whose tool list leaves it out
  cannot retrieve; set `subagent_compression_enabled` to `false` if such agents
  need exact output. A read-modify-write over another MCP server's JSON should
  fetch the whole value first.
- **A dedup pointer may name a result that left the context.** After
  compaction the result a pointer names may be gone from the conversation;
  `headroom_retrieve` with the pointer's hash still returns the run while the
  mod is loaded.
- **The dedup corpus is bounded.** It indexes at most 4 million characters
  across the main loop and all subagents (the least recently active
  conversation is dropped first) and starts over on `/clear`, a hot reload and
  an options change; a repeat of older content stays verbatim.
- **Markers start at column zero.** A dedup pointer or an elider retrieval line
  inside an indented subagent report is not indented.
- **Compression counts are not persisted.** The `smart crusher`, `dedup` and
  `line elider` tables have only their `session` row; the today / 7 days / 30
  days rows hold no compression numbers, because storing them needs new stats
  columns and a storage protocol bump.
- **Deferred SmartCrusher parts.** Upstream's lossless compaction (table and
  CSV rendering), the string, number and mixed-array crushers (those arrays
  keep every element), opaque-blob substitution (`<<ccr:HASH,KIND,SIZE>>`), the
  zlib check of the adaptive row count and the embedding relevance scorer
  (stubbed upstream too) are not ported.
- **Updating from 0.2.0 needs a session restart.** The storage protocol is now 2:
  a session still running 0.2.0 gets "restart this session" from every storage
  tool until it restarts. Downgrading to 0.2.0 after this update leaves storage
  unavailable (the database schema is newer) until the plugin is updated again.
- Mid-turn user input (a queued command) arriving after the first step is still
  treated as a mechanical step.
- Date-only ISO values in stable shared text are flagged too (flag only, as upstream).
- The mods API is early-access; shapes may change between Claude Code releases.

## Upstream mapping and deviations

### Dense line elider

Ported from `headroom/transforms/dense_line_elider.py`, the `content_router.py`
`_elide_dense` CCR marker and `recursive_json.py` `scan_json_documents` (read
2026-10-11 at 976aa71). Ported verbatim:

- `MIN_LINE_CHARS` 300; `MAX_SPACE_RATIO` 0.06, with `>=` rejecting;
  `MIN_DENSE_TOTAL_CHARS` 2000; `HEAD_CHARS` 160; `TAIL_CHARS` 80.
- The early return below 300 characters, the tab guard and the JSON-shaped
  guard.
- The labelled-JSON guard through the span scan, including the work budget of
  4 per character + 4096, where an incomplete scan means not dense.
- The split on `\n` only, the per-line omission note text, and the CCR
  retrieval line `[N dense machine-generated line(s) elided. Retrieve original: hash=H]`
  appended after the block, with the whole pre-elision block stored under the
  hash.
- No elision of text another compressor rewrote (SmartCrusher output).

Deviations:

- The 12-hex `hash64`-based content hash stands in for upstream's CCR key, as
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

### Cross-turn dedup

Ported from `headroom/transforms/cross_turn_dedup.py` and the `content_router.py`
`_cross_turn_dedup_messages` wiring (read 2026-10-11 at 976aa71). Ported
verbatim:

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

Deviations:

- Incremental at append time instead of a per-request batch. The corpus is per
  conversation (the main loop, or one subagent) and lives in module memory. It
  is capped at 4,000,000 indexed characters across conversations, dropping the
  least recently appended conversation first, or resetting the current one when
  it alone exceeds the cap. It is cleared on `/clear` and lost on a mod reload.
- The pointer names `result N`, where N is the mod's 1-based ordinal of the
  conversation's indexed tool results, instead of `msg N`. N is the message
  index in upstream's request; the mod has no request-level view at append
  time.
- The pointer adds ` hash=H`. Upstream recovery is in context only, but the mod
  also stores the folded run's exact text in the CCR store, so a pointer whose
  original was compacted away stays recoverable while the mod is loaded.
- Because of that suffix, a fold is emitted only when the pointer is shorter
  than the run. Upstream relies on `min_chars` alone for its net win.
- The anchor is quoted with `JSON.stringify` (always double quotes) instead of
  Python `repr`. It is truncated by code points, as upstream does.
- A line number beyond `Number.MAX_SAFE_INTEGER` is treated as non-numbered.
- JS `\d` is ASCII-only where Python's `str` regex `\d` is Unicode.
- Lengths count UTF-16 units.

## Local development

```bash
claude --plugin-dir plugins/inline-headroom
claude plugin validate plugins/inline-headroom
claude plugin test plugins/inline-headroom
```
