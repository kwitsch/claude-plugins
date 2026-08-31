# linux-token-efficiency

**LINUX-ONLY TOOLING.** This plugin's `rtk` binary — installed into `~/.local/bin` — and the
codebase-memory-mcp binary it downloads are Linux x86_64 executables. On macOS, Windows or any other operating system every hook
no-ops and none of that tooling runs; the always-on terse output style (below) is the one
component that still applies.

## Install

```
/plugin install linux-token-efficiency@kwitsch-plugins
```

## What it does

Bundles the [rtk](https://github.com/rtk-ai/rtk) token-optimizing CLI proxy — release **v0.45.0**,
asset `rtk-x86_64-unknown-linux-musl.tar.gz` — into `~/.local/bin/rtk` on first use (only when not
already present there), and routes Bash tool calls through it automatically.

At SessionStart the plugin installs rtk to `~/.local/bin/rtk` (when absent); it is invocable by
hand as `rtk …` even when `~/.local/bin` itself is not on your `PATH`, via a small bridge wrapper
the plugin also puts on `PATH` (a small wrapper under the plugin's own `bin/`, always added while
the plugin is enabled), and the
rewrite gracefully no-ops when neither resolves. On top of that, a `PreToolUse` hook routes each Bash command: a
conservatively classified read-only gather command (a bare `curl` GET, a ≥3-command chain of text
tools like `grep`/`cat`/`wc`, or a ≥3-stage text pipeline) is denied with a ready-to-use
replacement call on context-mode's `ctx_fetch_and_index` / `ctx_batch_execute` / `ctx_execute`
(see "context-mode steering" below); every other command is piped into the bundled binary's own
`rtk hook claude` protocol and the rewritten, token-optimized command handed back to the harness —
no `rtk` prefix to remember. The split is deliberate: `git`/`gh` and anything with side effects
stay in Bash under rtk compression; only output-heavy read-only gathering moves to the
context-mode sandbox, where output is indexed instead of entering the context window.

## Configuration options

Set via `/plugin manage`, stored in settings.json under
`pluginConfigs["linux-token-efficiency"].options`.

| Option          | Default | Effect / Value                                                                                                                                                                                                                                                                                                |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_rewrite`  | `true`  | `true` (or unset): rewrite every Bash command through rtk. `false`: no rewriting. Only literal `false` disables.                                                                                                                                                                                              |
| `cbm_enabled`   | `true`  | `true` (or unset): run the `codebase-memory` MCP server (downloading the pinned cbm release into the plugin data dir on first start) and enable its four `mcp_tool` context hooks. `false`: neither runs and nothing is downloaded. Only the literal value `false` disables.                                  |
| `rtk_enabled`   | `true`  | `true` (or unset): at SessionStart, install the pinned rtk release into `~/.local/bin/rtk` when absent (download + dual-sha256-verify against the pin, atomic). `false`: nothing is installed or downloaded. Only the literal value `false` disables.                                                         |
| `steer_enabled` | `true`  | `true` (or unset): deny-steer WebFetch and read-only Bash gather commands to context-mode's `ctx_*` tools (see "context-mode steering" below). `false`: no steering — the escape hatch when the context-mode server is unavailable. Does not affect the rtk rewrite. Only the literal value `false` disables. |

The `context-mode` server (below) has no toggle — it is always enabled. `steer_enabled` gates only
the two steering hooks, never the server itself.

## When the hook does nothing

The rewrite is an optimization and fails open everywhere — a command that stays in Bash is never
broken by it (the steering branch above is the only path that denies, and only with a working
replacement in hand). The rewrite deliberately no-ops when:

- the host is not Linux;
- `auto_rewrite` is set to `false`;
- `~/.local/bin/rtk` is not yet installed (SessionStart install pending or `rtk_enabled=false`), or
  does not resolve — following a symlink — to a regular file (a symlinked install is fine; a
  dangling symlink or a directory is not), or nothing on the Bash `PATH` resolves to `rtk` at all;
- **a global `rtk` install appears earlier on `PATH`** — that install and its own hook already own
  the rewrite, and this plugin never double-wires (its own PATH-bridge wrapper under `bin/` is not
  treated as a competing install). On such a machine (a maintainer's own, typically)
  the plugin looks inert by design;
- `rtk` does not resolve on `PATH` at all — the hook never emits a command it has no evidence can
  run;
- the bundled rtk exits non-zero, times out (5 s) or prints anything other than its rewrite JSON;
- the host is Linux but not x86_64 — the musl binary cannot exec there, the spawn fails and the
  command runs unmodified (no token savings until an aarch64 binary is bundled).

## codebase-memory-mcp

Ships [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) — release **v0.10.1**,
asset `codebase-memory-mcp-linux-amd64-portable.tar.gz` — as the MCP stdio server `codebase-memory`
registered through `.mcp.json`. Its 15 graph tools appear as
`mcp__plugin_linux-token-efficiency_codebase-memory__*` (the plugin-namespaced tool-name form; a
bare `mcp__codebase-memory__*` matcher never fires for a plugin-bundled server), named after
upstream's own tool names.

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

## context-mode

Registers the external [context-mode](https://github.com/mksglu/context-mode) npm package
(Elastic License 2.0) — pinned to **1.0.169** — as the MCP stdio server `context-mode`. Its eleven
`ctx_*` tools (`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_index`, `ctx_search`,
`ctx_fetch_and_index`, `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`) appear as
`mcp__plugin_linux-token-efficiency_context-mode__*` (the plugin-namespaced tool-name form — not the
bare `mcp__context-mode__*`, which never fires for a plugin-bundled server).

`bin/context-mode-launch.sh` starts it: `bunx context-mode@1.0.169` when `bunx` resolves, otherwise
`npx --yes context-mode@1.0.169`, and an error on stderr with exit 1 when neither is installed. The
package is fetched from the npm registry on first start into bun's or npm's own global package cache
(not this plugin's data directory), so the first handshake is slower, and on an offline host the
server simply shows as not connected in `/mcp` — nothing else in the plugin depends on it. Unlike the
cbm download, a registry fetch cannot be sha256-verified: the version pin buys reproducibility, not
integrity. context-mode keeps its own SQLite knowledge base at its upstream default location.

**Session-start routing rules.** `hooks/SessionStart.md` is upstream's own routing-rules document,
copied byte-for-byte, and a `SessionStart` hook literally runs `cat` on it, so its ~5 KB of rules are
injected on every `startup`, `resume`, `clear` and `compact`.

**context-mode steering** (`steer_enabled`, default on). Two `PreToolUse` hooks turn the routing
rules from advice into enforcement, each deny carrying a complete, ready-to-use replacement call:

| Denied call                                                                          | Replacement in the deny reason                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| every `WebFetch`                                                                     | `ctx_fetch_and_index(url, source)` then `ctx_search` |
| Bash: a single bare `curl` GET                                                       | `ctx_fetch_and_index(url, source)` then `ctx_search` |
| Bash: ≥3 chained read-only text-tool commands (`grep`, `cat`, `wc`, `find`, `jq`, …) | `ctx_batch_execute(commands, queries)`               |
| Bash: a ≥3-stage all-read-only pipeline                                              | `ctx_execute(language: "shell", code)`               |

The Bash classifier is deliberately conservative: anything with side effects, redirects, command
substitution, unknown programs, backgrounding, `git`/`gh`, or `wget` (whose default is a file
download) stays in Bash and gets the rtk rewrite instead. Steering never depends on the rtk binary
and works even with `auto_rewrite` off. If the context-mode server is not connected, a denied call
has no working replacement — set `steer_enabled` to `false` as the escape hatch.

**The document's "BLOCKED" sections are upstream's claims — as of 0.4.0 the steering hooks make
some of them real.** `WebFetch` and bare `curl` GETs are now actually denied (by this plugin's own
hooks, not by upstream's routing engine, which is still not ported). Still not intercepted: `wget`
and inline HTTP inside sandboxed code. The file is kept verbatim so that re-syncing with upstream
stays a plain copy.

**`ctx_execute` and `ctx_batch_execute` run code and shell commands inside context-mode's sandbox**,
which does not pass through `Bash` `PreToolUse` hooks — neither this plugin's rtk rewrite nor another
plugin's deny gates see them. There is no toggle to disable this — the server is always registered,
and the steering hooks knowingly route more work through this bypass.

**Three token-efficiency signals now coexist** in this one plugin: rtk's Bash rewriting, cbm's graph
nudges, and context-mode's "prefer `ctx_*` over Bash/Grep/Read" rules. They never conflict
mechanically (an MCP tool call cannot match a `Bash` matcher) but they do compete for the model's
attention.

**Native Windows.** `bin/context-mode-launch.sh` is a `#!/usr/bin/env bash` script and the
`SessionStart` hook runs a bare `cat` — neither `bash` nor `cat` is on `PATH` by default on native
Windows (outside WSL or Git Bash), so both fail to start there, unlike the rtk/codebase-memory
features which are already Linux-only for a different reason (bundled Linux binaries).

## Terse output style

Registers the output style `terse` (`output-styles/terse.md`). Its frontmatter carries
`force-for-plugin: true`, so Claude Code applies it automatically whenever the plugin is enabled and
**overrides whatever style you picked via `/config`** — there is no activation step and no toggle.
`keep-coding-instructions: true` keeps Claude Code's built-in software-engineering instructions
active, so only response formatting changes, never coding behavior.

What it enforces: responses as short as their content allows — multi-level bullet lists instead of
prose, no preamble, no postamble, no restating the task, no narrating routine work, and only the
feedback you genuinely need, once.

It takes effect in a new session or after `/clear`, and it governs the main conversation only (a
subagent has its own system prompt). It is also this plugin's **one OS-independent component**: it
applies on macOS and Windows too, where every hook and bundled binary stays inert.

## Maintenance

The rtk release is pinned in `rtk-bundle.json` and installed at runtime into `~/.local/bin/rtk` by
`hooks/rtk-install.mjs`. The repo-level `update-linux-token-efficiency` skill compares that pin
against the latest upstream release and, on `apply`, recomputes `rtk-bundle.json` only — no binary
is ever committed or replaced, matching the cbm paragraph below.

The cbm release is pinned in `cbm-bundle.json`, with the advertised tool list snapshotted in
`cbm-tools.json`. The same `update-linux-token-efficiency` skill refreshes both via
`update-cbm-bundle.sh`: it verifies the download against the release's own `checksums.txt`, probes the
binary's `tools/list` for the snapshot, and rewrites only those two JSON files — no artifact is ever
committed.
