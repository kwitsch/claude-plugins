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

Prints the session's stats:

```
effort routing: on · main-loop steps 12 · clamped 7
cache aligner: on · last hit 94% · drops 1
volatile shared values: env uuid 123e4567-e89…
```

The volatile line reads `none` when no shared section holds a volatile value.

## Storage

A persistent JSON key-value store that later inline-headroom features will build
on. Nothing in the mod uses it yet, so `/headroom` stats still reset on reload.
It is the MCP server `storage` (connected as `plugin:inline-headroom:storage`)
with four tools:

| Tool             | What it does                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- |
| `kv_get`         | Read the JSON value stored under a key.                                            |
| `kv_set`         | Store a JSON value under a key (at most 1 MiB serialized, keys at most 512 chars). |
| `kv_delete`      | Delete a key.                                                                      |
| `storage_status` | Report the service pid, protocol and schema version.                               |

- **One background process per host.** The first tool call starts a detached
  service process that every session shares. It is the only process that opens
  the database. It exits after 10 idle minutes and starts again on the next call.
- **Files** live in the plugin data directory
  (`~/.claude/plugins/data/<plugin-id>/`), which survives plugin updates:
  `storage.db` (plus `storage.db-wal` while the service runs), `storage.sock`
  (an owner-only socket that exists only while the service runs) and
  `service.log` (fatal service errors only).
- **Requires Node >= 22.13** (`node:sqlite`). On an older Node the tools return
  an error that points at `service.log`.
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
  $0.011 of cache re-writes per switch. Watch the `drops` count in `/headroom` and
  the `cache drop` log lines; set `effort_routing_enabled` to `false` if clamps
  coincide with drops.
- **Stats reset on reload.** Counters live in module memory and reset when the mod
  hot-reloads or its options change.
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
