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

Both levers are on by default. Only a literal `false` disables one. Set them via
`/plugin -> installed -> inline-headroom -> Configure options`, or in
`settings.json`:

```json
{
  "pluginConfigs": {
    "inline-headroom": {
      "options": {
        "effort_routing_enabled": false,
        "cache_aligner_enabled": true
      }
    }
  }
}
```

| Option                   | Default | Effect / Value                                                                                    |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------- |
| `effort_routing_enabled` | `true`  | Lower effort to `low` on main-loop steps that only resume after successful tool results.          |
| `cache_aligner_enabled`  | `true`  | Flag volatile values in the `shared` system-prompt sections and log prompt-cache hit-ratio drops. |

## `/headroom`

Prints the session's stats:

```
effort routing: on · main-loop steps 12 · clamped 7
cache aligner: on · last hit 94% · drops 1
volatile shared values: env uuid 123e4567-e89…
```

The volatile line reads `none` when no shared section holds a volatile value.

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
