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

| Option         | Default | Effect / Value                                                                                                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_rewrite` | `true`  | `true` (or unset): rewrite every Bash command through the bundled rtk. `false`: no rewriting — the bundled `rtk` stays on `PATH` for manual use. Only literal `false` disables. |

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

## Maintenance

The bundled binary is pinned in `rtk-bundle.json`. The repo-level
`update-linux-token-efficiency` skill (`.claude/skills/`) compares that pin against the latest
upstream release and, on `apply`, re-downloads every binary, verifying each one against exactly
one matching entry in the release's own `checksums.txt` before replacing anything.
