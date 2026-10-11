# inline-headroom

Headroom-style levers inside Claude Code as a mod: clamp-only effort routing
after successful tool results, a detector-only CacheAligner that flags
volatile system-prompt content and cache-hit drops, and a SmartCrusher with
lossless compaction, cross-turn dedup, a dense line elider, a config
compressor and an HTML extractor that shrink tool results before the model
reads them (originals retrievable, custom workflow tags kept whole). Ports
eight levers and the tag protector of
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
| SmartCrusher      | headroom SmartCrusher (lossy array paths)                  | Rewrites a successful tool result of any tool whose text (a string or text block) is one JSON document longer than 800 characters, before the model first reads it: in the main loop, and in subagent and Workflow-agent results while `subagent_compression_enabled` is on. Read results never qualify (their line numbers stop the text from parsing). An array of 5 or more objects keeps at most an adaptive K (3 to 15) rows plus every error row, outlier and anomaly (first and last rows, change points, top search results, log clusters, rows matching the conversation); unique entities with no such signal stay whole. Arrays of 9 or more strings, numbers or mixed values keep their errors, outliers and first and last items. A shortened array ends with a `<<ccr:HASH N_rows_offloaded>>` (or `N_items_offloaded`) marker that `headroom_retrieve` resolves. Error results are never rewritten. |
| Compaction        | headroom SmartCrusher lossless compaction (csv-schema)     | Before the SmartCrusher drops a row, an array of 5 or more objects longer than its adaptive K is rendered as one typed schema line plus CSV rows (`[N]{id:int,name:string,…}` then `1,alice`), heterogeneous arrays split into buckets by a shared string field; when that saves at least 15% of the array's JSON the table replaces the array (as a JSON string), and nothing is dropped, so nothing needs retrieving. Runs while `smart_crusher_enabled` is off too (then an array whose table loses keeps every row). Error results are never rewritten.                                                                                                                                                                                                                                                                                                                                                        |
| Cross-turn dedup  | headroom cross_turn_dedup.py                               | Replaces each run of 3 or more lines (40+ characters) in a tool result that already appeared in an earlier tool result of the same conversation (the main loop, or one subagent), verbatim or with every line number shifted by one constant, with a one-line pointer: `[↑nL same as result K: "anchor" hash=H]`, or `[↑nL same as result K +dL: "anchor" hash=H]` for a shifted re-read. K counts that conversation's tool results from 1, the earliest copy is never rewritten, and `headroom_retrieve` with the hash returns the run's exact text. A result that repeats an earlier one in full becomes a single pointer. Error results and Read results are never rewritten but count as originals, so a re-Read always shows the file verbatim for the next Edit.                                                                                                                                             |
| Dense line elider | headroom dense_line_elider.py                              | Shortens each line of 300+ characters with under 6% spaces, no tab and no JSON in it (minified JS/CSS, base64, RSC payloads) to its first 160 and last 80 characters around `...[N chars of dense machine-generated content elided]...`, once such lines add up to 2000+ characters in one result, and ends that result with `[N dense machine-generated line(s) elided. Retrieve original: hash=H]`; `headroom_retrieve` with the hash returns the whole original. It skips text the SmartCrusher rewrote, and error results.                                                                                                                                                                                                                                                                                                                                                                                     |
| Config compressor | headroom ConfigCompressor (Tier 1 and 2)                   | Shortens a YAML, TOML or INI tool result of 300+ characters: whole-line comments and blank lines (INI: column-0 `#`/`;` comments only) are dropped behind `[N comment/blank lines elided. Retrieve original: hash=H]`, then repeated lines and repeated multi-line blocks (Kubernetes container stanzas, CI jobs) fold behind exact `... (repeated N times)` and `... (repeats K lines from D lines back)` markers, kept only when they expand back to the same text; when no comment line was elided, the result ends with `[Repeated config lines folded. Retrieve original: hash=H]`. Comments that may be data (a YAML block scalar, a multi-line string) are kept. `headroom_retrieve` with the hash returns the original. Error results are never rewritten.                                                                                                                                                 |
| HTML extractor    | headroom HTMLExtractor (bounded stand-in, no trafilatura)  | Turns an HTML tool result (a web page) of 300+ characters into markdown-like text: scripts, styles, the head, navigation, footers, form controls, embedded media and comments are dropped (the text inside a form or dialog is kept); headings become `#` lines, list items `- ` lines, links `[text](href)`, table rows pipe-separated lines; `<pre>` keeps its whitespace and entities are decoded. The text ends with `[HTML extracted to text: N characters of markup removed. Retrieve original: hash=H]`, and `headroom_retrieve` with the hash returns the page. The dense line elider then runs on the extracted text. A page that extracts to nothing, or to nothing shorter, is left to the elider as it is. Error results are never rewritten.                                                                                                                                                          |
| Tag protector     | headroom tag protector (block mode, mask-free)             | Keeps custom workflow tags (any non-HTML5 tag such as `<system-reminder>`, `<tool_call>` or `<thinking>`, with everything between its open and close tag) whole in tool results: a JSON document holding one drops no row or item, a line holding one is never elided, a repeated run of lines touching one is never folded, and YAML, TOML, INI or HTML holding one is left to the elider and dedup. A result too tag-dense to scan within its budget is left untouched. It saves nothing itself, so it has no `/headroom` table, and it only matters while a compression lever is on.                                                                                                                                                                                                                                                                                                                            |

A content router (a light port of headroom's content detector) labels each
tool-result text as JSON, diff, HTML, git status, search results, build/log
output, YAML/TOML/INI config, source code or plain text, and runs only the
levers that fit: the SmartCrusher and lossless compaction see only JSON, the
config compressor only config and the HTML extractor only HTML, while the
dense line elider and cross-turn dedup see every type. It has no option of its own; each lever keeps its
toggle.

## Configuration options

All twelve options are on by default. For the lever toggles only a literal `false`
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
        "lossless_compaction_enabled": true,
        "cross_turn_dedup_enabled": true,
        "dense_line_elider_enabled": true,
        "config_compressor_enabled": true,
        "html_extractor_enabled": true,
        "tag_protector_enabled": true,
        "subagent_compression_enabled": true,
        "storage_enabled": true
      }
    }
  }
}
```

| Option                            | Default | Effect / Value                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort_routing_enabled`          | `true`  | Lower effort to `low` on main-loop steps that only resume after successful tool results.                                                                                                                                                                                            |
| `subagent_effort_routing_enabled` | `true`  | Apply the same clamp to each subagent and Workflow agent, per agent. Only active while `effort_routing_enabled` is on. Overrides effort set on purpose (agent frontmatter, Agent tool, Workflow); see [Notes & limitations](#notes--limitations).                                   |
| `cache_aligner_enabled`           | `true`  | Flag volatile values in the `shared` system-prompt sections and log prompt-cache hit-ratio drops.                                                                                                                                                                                   |
| `smart_crusher_enabled`           | `true`  | Compress large JSON arrays in successful tool results of any tool (Read results never qualify); dropped rows stay retrievable with `headroom_retrieve` while the mod is loaded (see [Notes & limitations](#notes--limitations)).                                                    |
| `lossless_compaction_enabled`     | `true`  | Before the SmartCrusher drops rows, rewrite a large JSON array of objects as a schema line plus CSV rows when that saves at least 15%; nothing is dropped. Also runs while `smart_crusher_enabled` is off.                                                                          |
| `cross_turn_dedup_enabled`        | `true`  | Replace a run of 3 or more lines (40+ characters) that repeats an earlier tool result of the same conversation with a one-line pointer; the run stays retrievable with `headroom_retrieve` while the mod is loaded.                                                                 |
| `dense_line_elider_enabled`       | `true`  | Shorten long, nearly space-free lines (minified bundles, base64, RSC payloads) in tool results to their head and tail; the original stays retrievable with `headroom_retrieve` while the mod is loaded.                                                                             |
| `config_compressor_enabled`       | `true`  | Shorten YAML, TOML and INI tool results: fold repeated lines and blocks losslessly and drop comments and blank lines behind a retrieval marker; the original stays retrievable with `headroom_retrieve` while the mod is loaded.                                                    |
| `html_extractor_enabled`          | `true`  | Turn HTML tool results into markdown-like text without scripts, styles, navigation and other boilerplate; the page stays retrievable with `headroom_retrieve` while the mod is loaded.                                                                                              |
| `tag_protector_enabled`           | `true`  | Keep custom workflow tags such as `<system-reminder>` whole: no compression lever drops, elides, folds or extracts the part of a tool result holding one.                                                                                                                           |
| `subagent_compression_enabled`    | `true`  | Also apply the six compression levers (SmartCrusher, lossless compaction, cross-turn dedup, dense line elider, config compressor, HTML extractor) to subagent and Workflow-agent tool results. Only active while one of them is on; see [Notes & limitations](#notes--limitations). |
| `storage_enabled`                 | `true`  | Run the host-wide SQLite storage service behind the `storage` MCP tools (see [Storage](#storage)). Fail-closed: only a literal `true` enables it.                                                                                                                                   |

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

compaction        arrays   saved
session                4   31200

config             texts   saved
session                1     640

html extractor     pages   saved
session                3   21000

volatile shared values: unavailable (Claude Code keeps plugins out of the system-prompt hooks)
```

- **Rows:** `session` is this session's counters, kept in memory and redrawn
  live. `subagents` counts this session's subagent and Workflow-agent steps and
  clamps, in memory only (never persisted). `today`, `7 days` and `30 days` are
  rolling windows of local calendar days that include today: totals across all
  sessions on this host, read from [storage](#storage) when the pane opens and
  every 10 s while it stays open. `session`, `today`, `7 days` and `30 days`
  count main-loop steps only. `smart crusher`, `dedup`, `line elider`,
  `compaction`, `config` and `html extractor` have only a `session` row, held
  in memory, which counts subagent results too: `dropped` counts the array
  rows this session's crushes replaced with a retrieval marker, `spans` the
  repeated runs replaced with a pointer, `lines` the dense lines elided,
  `arrays` the arrays rewritten as a lossless table, `texts` the config texts
  shortened, `pages` the HTML pages extracted, and each `saved` the characters
  that lever removed from tool results.
- **Tables follow their levers.** `effort routing` is shown only while
  `effort_routing_enabled` is on, and its `subagents` row only while both
  `effort_routing_enabled` and `subagent_effort_routing_enabled` are on.
  `cache aligner` and the volatile list are shown only while
  `cache_aligner_enabled` is on, `smart crusher` only while
  `smart_crusher_enabled` is on, `dedup` only while `cross_turn_dedup_enabled`
  is on, `line elider` only while `dense_line_elider_enabled` is on,
  `compaction` only while `lossless_compaction_enabled` is on, `config` only
  while `config_compressor_enabled` is on, and `html extractor` only while
  `html_extractor_enabled` is on. The tag protector has no table: it saves
  nothing itself. With every lever
  off the pane says so. Storage is read only while the `effort routing` or
  `cache aligner` table is shown.
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
and Ctrl+X then X always does. While it stays open the `session`, `subagents` and compression rows redraw whenever the stats change, and the other rows refresh every 10 s.

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
- **The session rows reset; persisted totals stay.** The `session` and
  `subagents` rows and every compression table live in module memory and start
  over on a hot reload, an options change and `/clear`.
  The today / 7 days / 30 days rows keep their totals, but a turn cut off by a
  reload or a crash before it ends is not persisted.
- **Compression rewrites tool results before the model first reads them.** The
  compression levers rewrite a tool
  result of any tool (Bash, Grep, WebFetch, MCP tools, an Agent's report, …) as
  it is stored, in the main loop and, while `subagent_compression_enabled` is
  on, in subagents and Workflow agents. The model and the transcript file read
  the compressed form; the screen's tool row and an SDK stream may show the
  original. Error results, `headroom_retrieve` itself and this plugin's own
  storage tools are never rewritten. Read results are never crushed (their line
  numbers stop the text from parsing as JSON) nor elided (every line starts with
  `N<tab>`, and upstream's elider never touches a line holding a tab), but they
  are deduplicated.
- **The elider skips more than minified code.** As upstream, a line is never
  elided when it holds a tab or any JSON object or array, however small (`{}`,
  `[1,2]`): a minified bundle with an `exports:{}` span stays whole. The port keeps
  upstream's guards as they are, with no minimum span size.
- **A crushed result arrives minified.** When rows are dropped, the whole
  document is re-serialized compactly, with numbers in their shortest form. A
  result that loses no row keeps its exact bytes (upstream minifies it too).
  Use Read for a file's exact text, for example before editing it.
- **The crusher's default output changed in 0.7.0.** With
  `lossless_compaction_enabled` on (the default) a uniform JSON array of
  objects usually comes back as a lossless table (a JSON string holding
  `[N]{name:type,…}` and CSV rows) instead of sampled rows plus a
  `_ccr_dropped` marker; nothing is dropped. Set
  `lossless_compaction_enabled` to `false` for the old sampled output.
- **Originals are retrievable while the mod is loaded.** Two in-memory stores
  keep the last 1000 originals each (at most 16 million characters each): one
  for the crusher's dropped rows and the elider's, config compressor's and
  HTML extractor's originals, which exist nowhere else, and one for folded
  dedup runs, so a
  flood of repeated reads never
  pushes out a crushed result's rows. A row that folds more runs than a store
  holds keeps all of its own until the next row arrives. Both live in memory
  only: a hot reload, an options change (any option change reloads the mod), a
  plugin update, a resume or a new process loses them while the transcript keeps
  the markers, and `headroom_retrieve` then answers with a denied call naming
  the hash (re-run the tool instead). Writing them to the storage server is not
  done. The tool accepts the bare hash, `hash=H` and a whole `<<ccr:H …>>`
  marker, with or without its closing `]` or `>>`. `headroom_retrieve` never asks for permission: the mod
  answers it before Claude Code's permission check, and it only reads what this
  session's own tool results held. It was live-verified callable from a
  general-purpose subagent, but an agent type whose tool list leaves it out
  cannot retrieve; set `subagent_compression_enabled` to `false` if such agents
  need exact output. A read-modify-write over another MCP server's JSON should
  fetch the whole value first.
- **A dedup pointer may name a result that left the context.** After
  compaction the result a pointer already in the transcript names may be gone
  from the conversation; `headroom_retrieve` with the pointer's hash still
  returns the run while the mod is loaded. A compaction empties the compacting
  conversation's dedup corpus, so no later pointer names a compacted result.
- **Trimming without a compaction is not seen.** Claude Code can clear or trim
  old tool results without raising a compaction, and the mod gets no event for
  that. The corpus keeps indexing such a result, so a later re-read of the same
  text becomes a pointer to a result the model no longer sees, and every further
  re-read repeats that pointer. `headroom_retrieve` with the pointer's hash
  returns the text while the mod is loaded.
- **The dedup corpus is bounded.** It indexes at most 4 million characters
  across the main loop and all subagents (the least recently active
  conversation is emptied first). A finished subagent's corpus is emptied when
  its turn completes, a compaction empties the compacting conversation's, and
  `/clear`, a hot reload and an options change start everything over; a repeat
  of older content stays verbatim. An emptied conversation's result numbers keep
  counting, so a pointer never reuses an earlier result's number.
- **Markers start at column zero.** A dedup pointer or an elider retrieval line
  inside an indented subagent report is not indented.
- **Custom tags narrow compression (0.7.0).** The tag protector treats every
  non-HTML5 tag as a workflow tag, as upstream: XML files, JSX/TSX components
  and Vue templates are full of them, so re-reads of such files fold less and
  their dense lines are elided less. Set `tag_protector_enabled` to `false` to
  compress them as before.
- **Unprotectable results pass through whole.** While the tag protector is on,
  a result so dense in tags (or unterminated quotes) that its tag scan runs out
  of budget is not compressed at all: leaving it whole beats cutting a tag.
- **Compression counts are not persisted.** The compression tables have only
  their `session` row; the today / 7 days / 30 days rows hold no compression
  numbers, because storing them needs new stats columns and a storage protocol
  bump.
- **Scalar and mixed arrays are crushed too (0.7.0).** Inside a crushable
  JSON document, an array of 9 or more strings, numbers or mixed values keeps
  its errors, outliers, change points and first and last items and ends with
  `… N more items <<ccr:HASH N_items_offloaded>>`; such arrays of 5 to 8 items
  are no longer searched for nested arrays to crush, as upstream.
- **Deferred SmartCrusher parts.** Upstream's tabular ingest (CSV text turned
  into records), opaque-blob substitution (`<<ccr:HASH,KIND,SIZE>>`), the zlib
  check of the adaptive row count and the embedding relevance scorer (stubbed
  upstream too) are not ported.
- **Updating from 0.2.0 needs a session restart.** The storage protocol is now 2:
  a session still running 0.2.0 gets "restart this session" from every storage
  tool until it restarts. Downgrading to 0.2.0 after this update leaves storage
  unavailable (the database schema is newer) until the plugin is updated again.
- Mid-turn user input (a queued command) arriving after the first step is still
  treated as a mechanical step.
- Date-only ISO values in stable shared text are flagged too (flag only, as upstream).
- The mods API is early-access; shapes may change between Claude Code releases.

## Upstream mapping and deviations

### Lossless compaction and array crushers

Lossless compaction is ported from
`crates/headroom-core/src/transforms/smart_crusher/compaction/` (`compactor.rs`,
`formatter.rs`, `classifier.rs`) and the lossless-first step of `crusher.rs`
(read 2026-10-11 at 976aa71). Ported verbatim:

- The defaults: at least 2 rows, core fields in 80% of the rows, buckets when
  under 60% of the keys are core (2 to 8 buckets, a discriminator at most 70%
  unique), at most 6 flattened inner keys, and the 15% savings floor.
- The order: an array within the adaptive row count is left alone, the table
  is tried before any row is dropped, and with the SmartCrusher off an array
  whose table loses stays whole.
- The table rules (column order, types, nullability, nested and stringified
  JSON cells, dotted columns for uniform nested objects) and the csv-schema
  text: `[N]{name:type,name:type?}`, CSV rows, `__buckets:` and `__key:` lines,
  `null` against an empty field, `""` and `"null"`, JSON literals for
  ambiguous strings in `json` columns.
- A top-level array comes back as a JSON string holding the table, which can
  fail the crusher's not-shorter check after passing the 15% floor.

Deviations:

- A column name holding `,` `:` `{` `}` `?` or a line break leaves the array
  as it is (upstream would write a header that no longer decodes), and a
  stringified cell `JSON.parse` would change stays a string.
- The work of one table is capped at 4 per character of the array's JSON +
  4096, so thousands of distinct keys cannot stall the append hook; such a
  table could not save 15% anyway.
- Numbers are typed and printed from their parsed value (`1.0` reads `int`,
  `1.50` prints `1.5`); lengths count UTF-16 units, keys sort by UTF-16 code
  units, and integer-like keys come first.
- No opaque-blob cells: long strings stay in the table verbatim.

The string, number and mixed-array crushers are ported from `crushers.rs` and
`crusher.rs` (`classify_array`, `crush_mixed_array`, the scalar drop marker).
Ported verbatim: 8 or fewer items pass through; the adaptive row count split
30% first and 15% last (rounded half to even, never more than the count);
strings keep error items, length outliers and a stride that skips repeats;
numbers keep outliers, every window-5 change point and a stride; mixed arrays
are grouped by type (groups under 5 kept whole, a dict group that compacts kept
whole); such arrays are never searched for nested arrays; a shortened one ends
with `… N more items <<ccr:HASH N_items_offloaded>>`. Deviations: number items
are sized from their printed value rather than their original spelling, and
the strategy text upstream logs is not built.

### Content detector / router

Ported from `headroom/transforms/content_detector.py` (the checks inside each
category), `crates/headroom-core/src/transforms/content_detector.rs` (the
category set and order) and the timestamp-row pattern of
`headroom/transforms/lossless_compaction.py` (read 2026-10-11 at 976aa71).
Ported verbatim:

- The categories and their order: JSON, diff (confidence 0.7 or more), HTML
  (0.7), git status, search results (0.6), build/log output (0.5),
  YAML/TOML/INI config, source code (0.5), else plain text; empty text is plain
  text.
- The sample windows: diff over the first 500 lines, HTML over the first 3000
  characters, search and code over the first 100 lines, logs over the first
  200 lines.
- Every pattern and threshold of these categories: the timestamped-log-row
  guard, the path-shape guard, grep context lines, at least 2 matching lines
  and a 0.3 ratio for search, all 24 log patterns with a 0.1 ratio, the code
  patterns of 8 languages with a best score of at least 3, JSON wrapped in a
  little text when the JSON is at least 60% of it, two or more
  whitespace-separated JSON objects, and the git status headings and entries.
- The confidence formulas, in upstream operand order.

Deviations:

- Upstream's Rust category set plus Python's YAML/TOML/INI config category,
  whose TOML and INI flavors come from line checks where Python runs its TOML
  and INI parsers (see [Config compressor](#config-compressor)). Python's
  tabular (markdown table, CSV/TSV) and fixed-width categories are left out:
  they only take text that would otherwise be code or plain text, which is
  handled the same way, and the newer tabular check disagrees with upstream's
  own test fixtures.
- JSON follows Python, not Rust: objects, wrapped payloads and concatenated
  objects count, not only arrays.
- JSON values are found with a bracket-span walk plus `JSON.parse` in place of
  Python's `raw_decode`. `NaN`/`Infinity` are not JSON here, and a parse that
  fails for any reason but a syntax error (Python: too deeply nested) means
  not JSON.
- JS `\w`, `\d` and `\b` are ASCII-only where Python's are Unicode, `\s` and
  `trim()` differ on a few exotic code points, and lengths count UTF-16 units.
- Each sampled line is cut to 1000 characters before the diff, search, log and
  code checks, so one huge line cannot stall the append hook; a signal past
  that column goes unseen.
- Only the label is kept: no confidence and no metadata.

Routing is a light form of `headroom/transforms/content_router.py` (read
2026-10-11 at 976aa71): JSON runs the SmartCrusher and config runs the config
compressor, each followed by the dense line elider when it changed nothing;
HTML runs the HTML extractor, then the dense line elider on its result (or on
the page when nothing was extracted); every other type runs the dense line
elider; cross-turn dedup then runs on every type. Routing deviations:

- A JSON text the SmartCrusher leaves alone is still elided; upstream skips
  elision after any SmartCrusher attempt.
- Diffs, git status and every other type get the dense line elider, as
  upstream does where a type's own compressor is unavailable. Upstream keeps
  git status verbatim; here its tab-indented entry lines are never dense
  anyway.
- None of upstream's mixed-content splitting, ML-based detection,
  lossless-first stage, fallback chains or concatenated-JSON normalization.

### Config compressor

Ported from `headroom/transforms/config_compressor.py`, the config folds of
`headroom/transforms/lossless_compaction.py` and the config branch of
`headroom/transforms/content_detector.py` (read 2026-10-11 at 976aa71). Ported
verbatim:

- Detection's patterns and thresholds: a section header plus mostly
  assignments for TOML/INI; for YAML at least 3 keys, mostly keys, list items
  and document markers, short non-sentence lines, and nesting, a document
  marker or 3 list items; markdown front matter is no config.
- Comment and blank-line removal behind
  `[N comment/blank lines elided. Retrieve original: hash=H]` (INI keeps blank
  lines and drops only column-0 comments), skipped where a `#` line may be data
  (a YAML block scalar, a TOML multi-line string).
- The lossless folds `... (repeated N times)` and
  `... (repeats K lines from D lines back)` (blocks of 3 to 64 lines, 8 recent
  positions per line, texts of 6 to 20,000 lines), kept only when they expand
  back to the exact text.

Deviations:

- Line checks stand in for Python's TOML and INI parsers, so text a parser
  would reject can still be treated as config; the folds verify themselves and
  the removed comments stay retrievable.
- INI also keeps its comments when the text holds `"""` or `'''`.
- The INI assignment check is a linear scanner, and expanding a fold to verify
  it stops once it outgrows the text, so neither can stall the append hook.
- Deferred: the TOML array-of-tables schema fold (it needs a real TOML parser).

### HTML extractor

Stands in for `headroom/transforms/html_extractor.py` (trafilatura) and its
router wiring (read 2026-10-11 at 976aa71). Kept from upstream: HTML is
extracted and the dense line elider then runs on the extraction, an empty
extraction falls through to the elider on the page, links and tables are
kept, images and comments dropped. Deviations:

- No trafilatura (a third-party package the mod cannot load): a hand-written
  pass drops scripts, styles, the head, navigation, footers, asides, form controls (buttons, selects, text areas),
  embedded media, SVG and MathML, and turns the rest into markdown-like text
  (headings, list items, `[text](link)`, table rows, `<pre>` kept as is,
  entities decoded). It does no main-content scoring, so more of a page stays.
- The page itself stays retrievable through the
  `[HTML extracted to text: … Retrieve original: hash=H]` line; upstream's
  extraction cannot be undone.
- Its work is capped at 4 per character + 4096; a page over that budget, or
  one whose extraction is not shorter, is left as it is.
- Dense grep or log output that looks like HTML (a doctype, an `<html>` tag or
  several structural tags) can be extracted like a page; the original stays
  retrievable.

### Tag protector

Ported from `crates/headroom-core/src/transforms/tag_protector.rs` (read
2026-10-11 at 976aa71), block mode. Ported verbatim: the HTML5 element names
it never protects (case-insensitive), its tag parser (quoted attributes,
self-closing tags, whitespace before a close's `>`), and the block rule (a
close matches the nearest open of its name, nested custom tags collapse into
the outermost block, orphan opens and closes are not protected). Deviations:

- No placeholders: instead of masking tags around ML compressors (which the
  mod does not have), each lever respects them: a JSON result holding one
  drops no row, the elider and dedup skip the lines they touch, and the config
  compressor and the HTML extractor leave such a result to the elider and dedup.
- A tag a decoded entity creates in an HTML extraction is protected too.
- The scan has a budget of 4 per character + 4096, which the open tags a close
  has to search through also draw on; a result that exhausts it is left whole
  (upstream has no bound).
- Tags inside an `<svg>` or `<math>` element are not workflow tags and are not
  scanned.

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
  is capped at 4,000,000 indexed characters across conversations, emptying the
  least recently appended conversation first (its result numbers keep
  counting), or the current one when it alone exceeds the cap. A finished
  agent's turn and a compaction of a conversation empty its corpus too. It is
  cleared on `/clear` and lost on a mod reload.
- The pointer names `result N`, where N is the mod's 1-based ordinal of the
  conversation's indexed tool results, instead of `msg N`. N is the message
  index in upstream's request; the mod has no request-level view at append
  time.
- The pointer appends a space and `hash=H`. Upstream recovery is in context only, but the mod
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
