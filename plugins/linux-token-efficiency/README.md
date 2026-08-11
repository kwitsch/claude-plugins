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

| Option         | Default | Effect / Value                                                                                                                                                                     |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_rewrite` | `true`  | `true` (or unset): rewrite every Bash command through the bundled rtk. `false`: no rewriting — the bundled `rtk` stays on `PATH` for manual use. Only literal `false` disables.    |
| `cbm_enabled`  | `true`  | `true` (or unset): start the bundled codebase-memory-mcp as an MCP stdio server and enable its four context hooks. `false`: neither runs. Only the literal value `false` disables. |

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

Bundles [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) — release **v0.10.1**,
asset `codebase-memory-mcp-linux-amd64-portable.tar.gz` — and registers it as the MCP stdio server
`codebase-memory` through `.mcp.json`. Its 15 graph tools appear as `mcp__codebase-memory__*`.

**Why a tarball, not a binary.** The extracted executable is 279.6 MiB, above GitHub's 100 MiB
per-file limit, so the 37.6 MiB compressed archive is the committed artifact. On the server's first
start, `bin/cbm-launch.sh` verifies it against the committed `bin/cbm-checksums.txt`, extracts it
once, verifies the extracted binary's own hash, and `exec`s it. Extraction takes a few seconds once
per pinned version and is never paid again.

**Extraction cache.** `${CLAUDE_PLUGIN_DATA}/cbm/<first-16-hex-of-binary-sha256>/codebase-memory-mcp`.
It is content-addressed, so a version bump lands in a new directory and old ones are simply left
behind — there is no pruning. Reclaim the space by hand:

```bash
rm -rf "$HOME/.claude/plugins/data/linux-token-efficiency/cbm" # path per your CLAUDE_PLUGIN_DATA
```

This is the plugin's own extraction cache only. cbm's graph database lives at its own upstream
default (`~/.cache/codebase-memory-mcp`, `CBM_CACHE_DIR`), which this plugin never sets or touches.

**The four context hooks** all run `bin/cbm-launch.sh cli <tool> … --json` and inject text only —
they never block, deny, rewrite or replace a tool call, and they never extract (a cold cache means
they stay silent):

| Event                      | cbm tool               | What it injects                                                                                               |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `SessionStart`             | `index_status`         | the graph project covering this repo, its index state, and a nudge to prefer the graph tools over text search |
| `SubagentStart`            | `index_status`         | the same, shorter, plus "pass qualified symbols/paths through"                                                |
| `PreToolUse` `Grep`/`Glob` | `search_graph`         | up to 10 matching qualified symbols with files/lines                                                          |
| `PostToolUse` `Read`       | `check_index_coverage` | a warning **only** when the graph could not fully index that file                                             |

Nothing is injected when no graph project matches the session's directory (indexing is never
suggested and never started), when the result is empty, or when cbm fails, times out (5 s) or returns
an unrecognized payload.

**Enabled by default.** Enabling the plugin is the consent step: there is **no separate `/mcp`
approval prompt** for a plugin-provided server. Set `cbm_enabled` to `false` to opt out — the server
then exits 0 immediately and shows up as not connected in `/mcp`, and all four hooks stay silent
(only the literal value `false` disables). Disabling does not delete an already-extracted cache.

**After a plugin update, restart your sessions.** cbm requires every active process (MCP server,
hooks, one-shot CLI) to run the exact same executable build; a session whose server started on the
previous build keeps running it, while newly spawned hooks would use the new one and be refused
(harmlessly — the hook falls silent).

## Maintenance

The bundled rtk binary is pinned in `rtk-bundle.json`. The repo-level
`update-linux-token-efficiency` skill (`.claude/skills/`) compares that pin against the latest
upstream release and, on `apply`, re-downloads every binary, verifying each one against exactly
one matching entry in the release's own `checksums.txt` before replacing anything.

The bundled cbm tarball is pinned separately in `cbm-bundle.json`. The same
`update-linux-token-efficiency` skill refreshes it via `update-cbm-bundle.sh`, verifying against
the release's own `checksums.txt` before replacing anything and rewriting `bin/cbm-checksums.txt`.
