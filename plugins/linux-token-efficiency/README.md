# linux-token-efficiency

**LINUX ONLY.** This plugin bundles a Linux x86_64 executable. On macOS, Windows or any other
operating system every hook no-ops and the plugin does nothing.

## Install

```
/plugin install linux-token-efficiency@kwitsch-plugins
```

## What it does

Bundles the [rtk](https://github.com/rtk-ai/rtk) token-optimizing CLI proxy — release **v0.45.0**,
asset `rtk-x86_64-unknown-linux-musl.tar.gz` — at `bin/rtk`, and routes Bash tool calls through it
automatically.

Claude Code adds an enabled plugin's `bin/` to the Bash `PATH`, so `rtk` is invocable by hand as
soon as the plugin is enabled. On top of that, a `PreToolUse` hook pipes each Bash command into the
bundled binary's own `rtk hook claude` protocol and hands the rewritten, token-optimized command
back to the harness — no `rtk` prefix to remember.

## Configuration options

Set via `/plugin manage`, stored in settings.json under
`pluginConfigs["linux-token-efficiency"].options`.

| Option         | Default | Effect / Value                                                                                                                                                                                                                                                               |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_rewrite` | `true`  | `true` (or unset): rewrite every Bash command through the bundled rtk. `false`: no rewriting — the bundled `rtk` stays on `PATH` for manual use. Only literal `false` disables.                                                                                              |
| `cbm_enabled`  | `true`  | `true` (or unset): run the `codebase-memory` MCP server (downloading the pinned cbm release into the plugin data dir on first start) and enable its four `mcp_tool` context hooks. `false`: neither runs and nothing is downloaded. Only the literal value `false` disables. |

## When the hook does nothing

The rewrite is an optimization and fails open everywhere — a Bash command is never blocked or
broken by it. It deliberately no-ops when:

- the host is not Linux;
- `auto_rewrite` is set to `false`;
- `bin/rtk` is missing or not executable (e.g. a checkout that lost the exec bit);
- **a global `rtk` install appears earlier on `PATH`** — that install and its own hook already own
  the rewrite, and this plugin never double-wires. On such a machine (a maintainer's own, typically)
  the plugin looks inert by design;
- `rtk` does not resolve on `PATH` at all — the hook never emits a command it has no evidence can
  run;
- the bundled rtk exits non-zero, times out (5 s) or prints anything other than its rewrite JSON;
- the host is Linux but not x86_64 — the musl binary cannot exec there, the spawn fails and the
  command runs unmodified (no token savings until an aarch64 binary is bundled).

## codebase-memory-mcp

Ships [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) — release **v0.10.1**,
asset `codebase-memory-mcp-linux-amd64-portable.tar.gz` — as the MCP stdio server `codebase-memory`
registered through `.mcp.json`. Its 15 graph tools appear as `mcp__codebase-memory__*`, exactly as
upstream names them.

**Nothing cbm-related is committed to this repo.** `mcp/server.mjs` is a small Node proxy: on its
first start it downloads the pinned release asset (37.6 MiB) from GitHub Releases, verifies its
sha256 against the pin in `cbm-bundle.json`, extracts it, verifies the extracted 279.6 MiB binary's
own sha256 against the pin too, and only then moves it into the cache with an atomic rename. It then
spawns that binary once as a long-lived child and forwards every tool call to it, so all 15 upstream
tools keep working unchanged. Both hashes must match or nothing is cached — a corrupted download or a
hijacked mirror can never produce an executed binary. The download happens once per pinned version
per cache root, is bounded by a 5-minute timeout, and is attempted at most once per server process:
on an offline or firewalled host the server degrades silently instead of hanging your session.

**Download cache.** `${CLAUDE_PLUGIN_DATA}/cbm/<first-16-hex-of-binary-sha256>/codebase-memory-mcp`.
It is content-addressed, so a version bump lands in a new directory and old ones are simply left
behind — there is no pruning. Reclaim the space by hand:

```bash
rm -rf "$HOME/.claude/plugins/data/linux-token-efficiency/cbm" # path per your CLAUDE_PLUGIN_DATA
```

This is the plugin's own download cache only. cbm's graph database lives at its own upstream default
(`~/.cache/codebase-memory-mcp`, `CBM_CACHE_DIR`), which this plugin never sets or touches.

**The four context hooks** are `mcp_tool` hooks served by that same warm server — no process is
spawned per event. They inject text only: they never block, deny, rewrite or replace a tool call.

| Event                      | Hook tool               | What it injects                                                                                               |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `SessionStart`             | `hook_session_context`  | the graph project covering this repo, its index state, and a nudge to prefer the graph tools over text search |
| `SubagentStart`            | `hook_subagent_context` | the same, shorter, plus "pass qualified symbols/paths through"                                                |
| `PreToolUse` `Grep`/`Glob` | `hook_symbol_context`   | up to 10 matching qualified symbols with files/lines                                                          |
| `PostToolUse` `Read`       | `hook_coverage_context` | a warning **only** when the graph reports incomplete coverage for that file                                   |

Nothing is injected when no graph project matches the session's directory (indexing is never
suggested and never started), when the result is empty or unrecognized, when a graph read exceeds its
4-second budget, or while the first-run download is still in flight. On the very first session after
a fresh install the `SessionStart` hook in particular injects nothing: an `mcp_tool` hook needs an
already-connected server, and the download is still running. Later sessions (and every `resume` /
`clear` / `compact`) run against a warm cache and a connected server.

**Enabled by default.** Enabling the plugin is the consent step: there is **no separate `/mcp`
approval prompt** for a plugin-provided server. Set `cbm_enabled` to `false` to opt out — the server
then exits 0 immediately, never reaches the network, and shows up as not connected in `/mcp`, and all
four hooks stay silent (only the literal value `false` disables). Disabling does not delete an
already-downloaded cache.

**After a plugin update, restart your sessions.** cbm requires every active process to run the exact
same executable build; a session whose server started on the previous build keeps running it.

## Maintenance

The bundled rtk binary is pinned in `rtk-bundle.json`. The repo-level
`update-linux-token-efficiency` skill (`.claude/skills/`) compares that pin against the latest
upstream release and, on `apply`, re-downloads every binary, verifying each one against exactly
one matching entry in the release's own `checksums.txt` before replacing anything.

The cbm release is pinned in `cbm-bundle.json`, with the advertised tool list snapshotted in
`cbm-tools.json`. The same `update-linux-token-efficiency` skill refreshes both via
`update-cbm-bundle.sh`: it verifies the download against the release's own `checksums.txt`, probes the
binary's `tools/list` for the snapshot, and rewrites only those two JSON files — no artifact is ever
committed.
