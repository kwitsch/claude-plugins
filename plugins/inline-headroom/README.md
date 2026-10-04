# inline-headroom

Headroom-style levers inside Claude Code as a mod: clamp-only effort routing
after successful tool results, and a detector-only CacheAligner that flags
volatile system-prompt content and cache-hit drops. Ports two
"output/caching" levers of [headroom](https://github.com/headroomlabs-ai/headroom)
faithfully to upstream semantics.

## Install

```
/plugin install inline-headroom@kwitsch-plugins
```

## What it does

| Lever          | Upstream mapping                                           | Behavior                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effort routing | headroom effort routing (structural success-vs-error rule) | On a main-loop model step after index 0 whose preceding tool results were all successful, lowers thinking effort to `low`. Clamp-only: never raises effort, never injects one, leaves numeric or absent effort alone, ignores subagents. Any tool error or deny since the last step keeps full effort. |
| CacheAligner   | headroom CacheAligner (detector only)                      | Scans the cacheable `shared` system-prompt sections for UUID, ISO-8601, JWT and 32/40/64-hex values and logs a line whenever the prompt-cache hit ratio drops from at least 60% to below 60% between steps. Never rewrites or reorders the prompt.                                                     |

## Configuration options

All three options are on by default. For the two levers only a literal `false`
disables one; `storage_enabled` is fail-closed, so anything but a literal `true`
turns storage off. Set them via
`/plugin -> installed -> inline-headroom -> Configure options`, or in
`settings.json`:

```json
{
  "pluginConfigs": {
    "inline-headroom": {
      "options": {
        "effort_routing_enabled": false,
        "cache_aligner_enabled": true,
        "storage_enabled": true
      }
    }
  }
}
```

| Option                   | Default | Effect / Value                                                                                                                                    |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort_routing_enabled` | `true`  | Lower effort to `low` on main-loop steps that only resume after successful tool results.                                                          |
| `cache_aligner_enabled`  | `true`  | Flag volatile values in the `shared` system-prompt sections and log prompt-cache hit-ratio drops.                                                 |
| `storage_enabled`        | `true`  | Run the host-wide SQLite storage service behind the `storage` MCP tools (see [Storage](#storage)). Fail-closed: only a literal `true` enables it. |

## `/headroom`

Opens a **Headroom** pane with four views of the stats. Nothing is printed to
the transcript, so the stats never enter the model's context:

```
1: Session  2: Today  3: 7 days  4: 30 days
showing: 7 days (2026-09-27 – 2026-10-03)
main-loop steps 340 · clamped 120
cache hit 91% · drops 4
```

- **Switching:** hotkeys `1`-`4` while the pane is focused, or click a button,
  or Tab to it and press Enter. The `showing:` line always names the view (and
  its dates); the active button is drawn at full strength, the others dim.
- **Session** is the default: every `/headroom` opens on it. It shows this
  session's counters, kept in memory:

  ```
  showing: Session
  effort routing: on · main-loop steps 12 · clamped 7
  cache aligner: on · last hit 94% · drops 1
  volatile shared values: env uuid 123e4567-e89…
  ```

  The volatile line reads `none` when no shared section holds a volatile value.
  Volatile values appear only in this view.

- **Today, 7 days and 30 days** are rolling windows of local calendar days that
  include today: totals across all sessions on this host, read from
  [storage](#storage) and updated at the end of each main-loop turn. Their cache
  hit is token-weighted (cache reads / all input tokens). With storage off they
  say so; when storage fails they show `storage unavailable: <reason>`.
- When the pane cannot be placed (headless, or a terminal too narrow for it),
  `/headroom` prints the Session view as text instead.

The pane docks beside the transcript in fullscreen at 110+ columns and otherwise sits
above the prompt. It takes the keyboard when the prompt is empty: Esc closes it,
and Ctrl+X then X always does. While it stays open it redraws whenever the stats change.

## Storage

A persistent host-wide SQLite store: a JSON key-value store for inline-headroom
features, and the `stats` table behind the `/headroom` Today / 7 days / 30 days
views. It is the MCP server `storage` (connected as
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
- **One background process per host.** The first tool call, or the first
  main-loop turn that ends while `storage_enabled` is on (the `/headroom` write),
  starts a detached service process that every session shares. It is the only
  process that opens the database. It exits after 10 idle minutes and starts
  again on the next call.
- **Files** live in the plugin data directory
  (`~/.claude/plugins/data/<plugin-id>/`), which survives plugin updates:
  `storage.db` (plus `storage.db-wal` while the service runs), `storage.sock`
  (an owner-only socket that exists only while the service runs) and
  `service.log` (fatal service errors only).
- **Requires Node >= 22.13** (`node:sqlite`). On an older Node the tools return
  an error that points at `service.log`, and the per-turn `/headroom` write
  retries the start (one `service.log` line per attempt, at most once a minute
  per session); set `storage_enabled` to `false` to stop it.
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
  coincide with drops.
- **The Session view resets; persisted totals stay.** The Session view lives in
  module memory and starts over on a hot reload, an options change and `/clear`.
  Today / 7 days / 30 days keep their totals, but a turn cut off by a reload or
  a crash before it ends is not persisted.
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
