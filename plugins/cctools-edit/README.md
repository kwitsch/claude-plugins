# cctools-edit

Installs the [cc-tools](https://github.com/devslimbr/cc-tools) binary for your
OS and routes `Read`/`Write`/`Edit`/`MultiEdit` through it, so files keep their
original encoding (Latin-1 / ISO-8859-1 / Windows-1252 / …) instead of being
silently corrupted to UTF-8.

## Install

```
/plugin install cctools-edit@claude-plugins
```

## What it does

Claude Code's native file tools assume UTF-8 everywhere. On a legacy-encoded
file (CP1252, ISO-8859-1, Shift_JIS, …) that means non-ASCII characters are
mangled — and a byte read as a partial UTF-8 sequence becomes the replacement
character `U+FFFD`, after which edits no longer match.

This plugin fixes that with two hooks:

- **SessionStart** — downloads the matching cc-tools release for your platform
  (idempotent; cached under `~/.claude/cctools/`), then primes the model with
  the exact cc-tools commands to use.
- **PreToolUse** (`Read|Write|Edit|MultiEdit`) — **denies** the native tool and
  tells the model to run the equivalent cc-tools command via Bash. Because the
  redirect runs over Bash, `cctools read` returns clean UTF-8, the model builds
  a correct `old_string`, and `cctools edit` re-encodes back to the original
  encoding — the read-side corruption is avoided end to end.

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
- Other Bash file operations (`cat`, `sed`, `>`) bypass cc-tools — the hook only
  covers the four native tools.
- Reads are also routed through cc-tools (full encoding protection), which adds
  a Bash round-trip per read. Set `CCTOOLS_SKIP_INSTALL` or remove the plugin if
  that's too heavy for your workflow.
