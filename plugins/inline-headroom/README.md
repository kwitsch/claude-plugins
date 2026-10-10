# inline-headroom

Headroom-style levers inside Claude Code as a mod: clamp-only effort routing
after successful tool results, a detector-only CacheAligner that flags
volatile system-prompt content and cache-hit drops, and a SmartCrusher that
compresses large JSON arrays in tool results. Ports three levers of
[headroom](https://github.com/headroomlabs-ai/headroom) faithfully to upstream
semantics.

## Install

```
/plugin install inline-headroom@kwitsch-plugins
```

## What it does

| Lever          | Upstream mapping                                           | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort routing | headroom effort routing (structural success-vs-error rule) | On a main-loop model step after index 0 whose preceding tool results were all successful, lowers thinking effort to `low`; with `subagent_effort_routing_enabled` on, each subagent and Workflow agent gets the same rule on its own steps, tracked per agent. Clamp-only: never raises effort, never injects one, leaves numeric or absent effort alone. Any tool error or deny since that loop's last step keeps full effort.                                                                                                                                                                                                                                                                                               |
| CacheAligner   | headroom CacheAligner (detector only)                      | Scans the cacheable `shared` system-prompt sections for UUID, ISO-8601, JWT and 32/40/64-hex values and logs a line whenever the prompt-cache hit ratio drops from at least 60% to below 60% between steps. Never rewrites or reorders the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SmartCrusher   | headroom SmartCrusher (dict-array lossy path)              | Rewrites a successful main-loop Bash result whose stdout is one JSON document, and each JSON text block of an MCP result, when it is longer than 800 characters. An array of 5 or more objects keeps at most an adaptive K (3 to 15) rows plus every error row, structural outlier and numeric anomaly: its first and last rows, the rows around change points, top-scored search results, one or two rows per log message cluster, and rows matching the conversation. Arrays of unique entities with no such signal stay whole. An array that lost rows ends with `{"_ccr_dropped":"<<ccr:HASH N_rows_offloaded>>"}`; the `headroom_retrieve` tool returns its original rows. Error and denied results are never rewritten. |

## Configuration options

All five options are on by default. For the lever toggles only a literal `false`
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
| `smart_crusher_enabled`           | `true`  | Compress large JSON arrays in successful main-loop Bash and MCP tool results; dropped rows stay retrievable with `headroom_retrieve` while the mod is loaded (see [Notes & limitations](#notes--limitations)).                                    |
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

volatile shared values: none
```

- **Rows:** `session` is this session's counters, kept in memory and redrawn
  live. `subagents` counts this session's subagent and Workflow-agent steps and
  clamps, in memory only (never persisted). `today`, `7 days` and `30 days` are
  rolling windows of local calendar days that include today: totals across all
  sessions on this host, read from [storage](#storage) when the pane opens and
  every 10 s while it stays open. `session`, `today`, `7 days` and `30 days`
  count main-loop steps only. `smart crusher` has only a `session` row, in
  memory only: `dropped` counts the array rows this session's crushes replaced
  with a retrieval marker, `saved` the characters they removed from tool
  results.
- **Tables follow their levers.** `effort routing` is shown only while
  `effort_routing_enabled` is on, and its `subagents` row only while both
  `effort_routing_enabled` and `subagent_effort_routing_enabled` are on.
  `cache aligner` and the volatile list are shown only while
  `cache_aligner_enabled` is on, and `smart crusher` only while
  `smart_crusher_enabled` is on. With all three levers off the pane says so.
  Storage is read only while the `effort routing` or `cache aligner` table is
  shown.
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
and Ctrl+X then X always does. While it stays open the `session`, `subagents` and `smart crusher` rows redraw whenever the stats change, and the other rows refresh every 10 s.

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
  `subagents` and `smart crusher` rows live in module memory and start over on
  a hot reload, an options change and `/clear`.
  The today / 7 days / 30 days rows keep their totals, but a turn cut off by a
  reload or a crash before it ends is not persisted.
- **SmartCrusher rewrites only large JSON the model asked for in the main
  loop.** It crushes a successful Bash result whose stdout is one JSON document
  (with empty stderr, and not interrupted, an image, backgrounded, timed out or
  saved to a file because it was too large) and the JSON text blocks of an MCP
  result, when they are longer than 800 characters. Subagent and
  Workflow-agent results, other plugins' tool calls, error and denied results,
  `headroom_retrieve` itself, this plugin's own storage tools and every other
  built-in tool (Read, WebFetch, …) are never rewritten.
- **A crushed result arrives minified.** When rows are dropped, the whole
  document is re-serialized compactly, with numbers in their shortest form. A
  result that loses no row keeps its exact bytes (upstream minifies it too).
  Use Read for a file's exact text, for example before editing it.
- **Dropped rows are retrievable while the mod is loaded.** The last 1000
  crushed arrays stay in memory; a hot reload, an options change or a new
  process loses them, and `headroom_retrieve` then answers with an error naming
  the hash (re-run the tool instead). The first `headroom_retrieve` call may ask
  for permission like any other tool. A read-modify-write over another MCP
  server's JSON should fetch the whole value first.
- **Crush counts are not persisted.** The `smart crusher` table has only its
  `session` row; the today / 7 days / 30 days rows hold no crusher numbers,
  because storing them needs new stats columns and a storage protocol bump.
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

## Local development

```bash
claude --plugin-dir plugins/inline-headroom
claude plugin validate plugins/inline-headroom
claude plugin test plugins/inline-headroom
```
