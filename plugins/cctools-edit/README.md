# cctools-edit

Installs the [cc-tools](https://github.com/devslimbr/cc-tools) binary for your
OS and routes `Read`/`Write`/`Edit`/`MultiEdit` through it, so files keep their
original encoding (Latin-1 / ISO-8859-1 / Windows-1252 / …) instead of being
silently corrupted to UTF-8.

## Install

```
/plugin install cctools-edit@kwitsch-plugins
```

## What it does

Claude Code's native file tools assume UTF-8 everywhere. On a legacy-encoded
file (CP1252, ISO-8859-1, Shift_JIS, …) that means non-ASCII characters are
mangled — and a byte read as a partial UTF-8 sequence becomes the replacement
character `U+FFFD`, after which edits no longer match.

This plugin fixes that with three hooks:

- **SessionStart** — downloads the matching cc-tools release for your platform
  (idempotent; cached under `~/.claude/cctools/`), then primes the model with
  the exact cc-tools commands to use.
- **PreToolUse** (`Read|Write|Edit|MultiEdit`) — **denies** the native tool and
  tells the model to run the equivalent cc-tools command via Bash. Because the
  redirect runs over Bash, `cctools read` returns clean UTF-8, the model builds
  a correct `old_string`, and `cctools edit` re-encodes back to the original
  encoding — the read-side corruption is avoided end to end.
- **PreToolUse** (`Bash`) — a secondary net for shell file ops the redirect
  can't see. It parses the command and **denies** it only when it would
  write/edit (`sed -i`, `>`, `>>`, `>|`, `&>`, `tee`) or bare-read (`cat`,
  `cat <`) an **existing file whose on-disk encoding is non-UTF-8** (checked
  with `file --mime-encoding`/`iconv`). New files, UTF-8/ASCII files, `/dev/*`,
  fd-dups (`2>&1`), quoted/heredoc/`$()` occurrences and non-literal targets all
  pass — it biases hard to precision and fails open on any uncertainty.

cc-tools mapping the model is steered toward:

| Native tool | cc-tools command |
|-------------|------------------|
| Read        | `cctools read --file <path> --detect-encoding` |
| Edit        | `cctools edit --file <path> --old <old> --new <new> [--replace-all]` |
| Write       | `cctools write --file <path> --stdin --encoding <ENC>` |
| MultiEdit   | `cctools multiedit --edits-file <edits.json>` |

If the exact string isn't found, cc-tools offers `--auto-normalize`,
`--aggressive-fuzzy --similarity <n>` and `--smart-code` for tolerant matching.

## Fail-open behaviour

If the binary can't be installed (no `curl`/`wget`, no `tar`/`unzip`, offline,
or a 404 for an unpublished OS/arch combo), the PreToolUse hook does **not**
block anything — the native tools stay enabled, so you're never left without a
way to edit files. In that state the plugin is effectively **inactive**, and the
SessionStart hook surfaces a user-facing warning (via the hook `systemMessage`
field) so you know encoding preservation is off, plus an `additionalContext`
note that tells Claude to flag non-UTF-8 edits.

The hooks parse/emit JSON with `jq`, or — when `jq` is absent — a
Node-compatible runtime (`node`, or `bun`). With none of the three available the
hooks fail open too, and SessionStart still emits a `systemMessage` warning so
the silent-disable is visible rather than going unnoticed.

## Working alongside context-mode

If you also run [context-mode](https://github.com/mksglu/context-mode), it steers
the model to read and process files through its MCP sandbox tools
(`ctx_execute_file`, `ctx_batch_execute`, `ctx_execute`) instead of the native
`Read`/`cat`. Those tools decode bytes as UTF-8 — which **corrupts** a Latin-1 /
Windows-1252 / Shift_JIS / UTF-16 file — and they sit outside this plugin's hook
matchers, so such a read would otherwise slip past encoding protection. To keep
the two safe together, cctools-edit's SessionStart priming tells the model that
**cc-tools takes precedence for any non-UTF-8 file**: read it with
`cctools read --detect-encoding` and edit it with `cctools edit`, never through a
sandbox/`ctx_execute*` tool. For plain UTF-8/ASCII files either path is fine. The
two plugins' Bash hooks coexist cleanly (a cctools-edit deny wins; no redirect
ping-pong).

## Configuration

Environment overrides (read by the hooks):

| Variable | Default | Purpose |
|----------|---------|---------|
| `CCTOOLS_VERSION` | `v1.0.0.0` | release tag to install |
| `CCTOOLS_HOME` | `~/.claude/cctools` | install directory |
| `CCTOOLS_BIN` | `$CCTOOLS_HOME/cctools[.exe]` | full path to the binary |
| `CCTOOLS_SKIP_INSTALL` | unset | skip auto-install (manage the binary yourself) |
| `CCTOOLS_FORCE` | unset | reinstall even if already present |

## Caveats

- The redirect relies on the model following the deny reason. A native-tool
  retry just gets denied again (no loop), but costs a round-trip.
- The `Bash` guard covers the common encoding-unsafe shell ops on **existing
  legacy files** (`cat`, `cat < f`, `sed -i`, `>`/`>>`/`>|`/`&>`, `tee`). By
  design it does *not* flag: byte-preserving moves (`cp`, `mv`, `tar`), `cat`
  inside a pipeline (`cat f | grep`), a processing command reading via input
  redirect (`grep x < f`, `wc < f` — the file isn't mutated and only processed
  output reaches the model), non-`-i` `sed`, in-place editors other than `sed -i`
  (`perl -i`, `awk -i inplace`, `ed`/`ex`), bare readers other than `cat`
  (`tac`/`head`/`tail`), or any op past its 2048-char command cap. It biases hard
  to precision (it must never block a legitimate command) and the redirect hook +
  priming already steer edits to cc-tools. It only acts on literal, existing,
  non-UTF-8 targets — so it never blocks new-file writes.
- Reads are also routed through cc-tools (full encoding protection), which adds
  a Bash round-trip per read. Set `CCTOOLS_SKIP_INSTALL` or remove the plugin if
  that's too heavy for your workflow.
