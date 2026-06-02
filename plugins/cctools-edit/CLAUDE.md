# CLAUDE.md — cctools-edit

Installs the [cc-tools](https://github.com/devslimbr/cc-tools) binary and routes
the native file tools through it so file encodings are preserved instead of
corrupted to UTF-8. Hook-only ("Instruct"/deny) architecture — no MCP server.

## Components
- `hooks/lib.sh` — sourced helpers: platform → release-asset mapping
  (`cctools_asset`), resolved paths (`cctools_bin`, `cctools_home`), download
  URL. All three scripts share it so they agree on where the binary lives.
- `hooks/install-cctools.sh` — idempotent installer. Detects OS/arch
  (`uname -s`/`-m`, overridable via `CCTOOLS_OS`/`CCTOOLS_ARCH`), downloads the
  pinned release (`CCTOOLS_VERSION`, default `v1.0.0.0`) with curl/wget, extracts
  `<os>_<arch>/cctools[.exe]` and installs it atomically to
  `~/.claude/cctools/cctools` (override `CCTOOLS_HOME`/`CCTOOLS_BIN`). Modes:
  `--print-asset`/`--print-bin`/`--print-url` (test hooks, no network);
  `CCTOOLS_SKIP_INSTALL=1` no-ops; `CCTOOLS_FORCE=1` reinstalls.
- `hooks/session-start.sh` (SessionStart) — runs the installer (its stderr noise
  kept off the JSON stdout), then emits `additionalContext` priming the model
  with the cc-tools command for each tool (and the path to the stashed
  `prompt.md` reference when present). Warns when the binary is absent.
- `hooks/redirect-to-cctools.sh` (PreToolUse, matcher `Read|Write|Edit|MultiEdit`)
  — emits `permissionDecision: "deny"` with a per-tool
  `permissionDecisionReason` mapping the op to its cc-tools equivalent.

## Behavior / key rules
- **Fail-open everywhere.** The redirect denies ONLY when the binary is present
  and `--version` runs; otherwise exit 0 (native tools stay usable) so the model
  is never stranded. Same for missing curl/wget/tar/unzip, no jq/node, malformed
  input, or an unrecognised tool name.
- **Why deny+Bash solves Read corruption:** `cctools read` runs over Bash and
  its stdout returns clean UTF-8, so the model's `old_string` matches the file's
  true bytes and `cctools edit` re-encodes to the original encoding.
- JSON parse/emit prefers `jq`, falls back to `node`; without either the
  redirect fails open and SessionStart stays silent.
- Installer is idempotent: a runnable `$BIN` short-circuits before any download.

## Tests
`test/cctools-edit/test.bats` (bats). Hermetic — no network: a dummy executable
stands in for the binary, `--print-asset`/`--print-url` cover the OS/arch
mapping, and `CCTOOLS_SKIP_INSTALL=1` keeps SessionStart offline. Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/cctools-edit/`.
