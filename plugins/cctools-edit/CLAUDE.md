# CLAUDE.md — cctools-edit

Installs [cc-tools](https://github.com/devslimbr/cc-tools) binary, routes native file tools through it so file encodings preserved not corrupted to UTF-8. Hook-only ("Instruct"/deny) architecture — no MCP server.

## Components
- `hooks/lib.sh` — sourced helpers: platform → release-asset mapping
  (`cctools_asset`), resolved paths (`cctools_bin`, `cctools_home`), download
  URL, `cctools_is_legacy_file` (encoding classifier via
  `file --mime-encoding`/`iconv`; cc-tools' own detector NOT used — it
  mislabels ASCII as ISO-8859-1). Classifier memoises per run via
  `CCTOOLS_ENC_CACHE` (set by `cctools_scan_command`) so each distinct path
  classified — thus forks `file` — at most once, even when one command
  mentions it many times. All scripts share lib.sh.
- `hooks/install-cctools.sh` — idempotent installer. Detects OS/arch
  (`uname -s`/`-m`, overridable via `CCTOOLS_OS`/`CCTOOLS_ARCH`), downloads
  pinned release (`CCTOOLS_VERSION`, default `v1.0.0.0`) with curl/wget, extracts
  `<os>_<arch>/cctools[.exe]`, installs atomically to
  `~/.claude/cctools/cctools` (override `CCTOOLS_HOME`/`CCTOOLS_BIN`). Modes:
  `--print-asset`/`--print-bin`/`--print-url` (test hooks, no network);
  `CCTOOLS_SKIP_INSTALL=1` no-ops; `CCTOOLS_FORCE=1` reinstalls.
- `hooks/session-start.sh` (SessionStart) — runs installer (stderr noise
  kept off JSON stdout), then emits `additionalContext` priming model
  with cc-tools command per tool (and path to stashed
  `prompt.md` reference when present). Warns when binary absent.
- `hooks/redirect-to-cctools.sh` (PreToolUse, matcher `Read|Write|Edit|MultiEdit`)
  — emits `permissionDecision: "deny"` with per-tool
  `permissionDecisionReason` mapping op to cc-tools equivalent.
- `hooks/guard-bash.sh` (PreToolUse, matcher `Bash`) — secondary net for shell
  file ops. Two-pass de-quoting parser (Pass A strips heredoc bodies incl.
  multiple/`<<-`/quoted delimiters; Pass B blanks quotes/`$'…'`/`$()`/backticks/
  `<()`/`>()`/escapes/comments to sentinel) then per-segment detectors find
  `sed -i`, OUTPUT redirections (`>` `>>` `>|` `&>` `1>`), `tee`, bare
  `cat` view (`cat file` or `cat < file`). INPUT redirect `< file` into any
  other (processing) command is read whose *output* — not file's raw
  bytes — reaches model, never mutates file, so **allowed**
  (denying = false positive, worst failure class here). Only
  **clean literal** tokens that are **existing non-UTF-8 files**
  (`cctools_is_legacy_file`) denied. Classify+collect runs subshell-free
  (`cctools_consider`) so per-run encoding memo survives. `--check`/`--strip`
  modes aid testing; bash-3.2 safe (no associative arrays); fast-path skips
  parser when command has no `>`/`<`/cat/sed/tee.

## Behavior / key rules
- **Fail-open everywhere.** Redirect denies ONLY when binary present
  and `--version` runs; else exit 0 (native tools stay usable) so model
  never stranded. Same for missing curl/wget/tar/unzip, no jq/node, malformed
  input, or unrecognised tool name.
- **Why deny+Bash solves Read corruption:** `cctools read` runs over Bash,
  its stdout returns clean UTF-8, so model's `old_string` matches file's
  true bytes and `cctools edit` re-encodes to original encoding.
- JSON parse/emit prefers `jq`, then Node-compatible runtime — `node` or
  `bun` (context-mode installs it; embedded snippets run byte-for-byte
  under it). With none of three, redirect/guard fail open and SessionStart
  emits static `systemMessage` warning so silent-disable stays visible.
- Installer idempotent: runnable `$BIN` short-circuits before any download.

## Interaction with context-mode (and other sandbox/processing plugins)
- Co-installed plugin like [context-mode](https://github.com/mksglu/context-mode)
  registers own `PreToolUse` hooks, steers model to read/process files
  through MCP **sandbox** tools (`ctx_execute`, `ctx_execute_file`,
  `ctx_batch_execute`) instead of native `Read`/Bash `cat`. cctools-edit's
  matchers (`Read|Write|Edit|MultiEdit`, `Bash`) do NOT cover those MCP tools, so
  legacy-file read routed through sandbox **bypasses** this plugin and
  sandbox UTF-8-decodes (corrupts) bytes. Mitigation: SessionStart
  priming asserts cc-tools **precedence** for any non-UTF-8 file, warns that
  sandbox/`ctx_execute*` reads corrupt and bypass — model told to use
  `cctools read`/`edit` for legacy files regardless of other guidance. (Guard via
  guidance, not by matching context-mode's tools: denying `ctx_execute_file`
  would break context-mode and those tools discard FS writes anyway.)
- Bash-hook coexistence correct: both plugins' `PreToolUse:Bash` hooks run as
  independent processes (each gets own stdin copy); cctools-edit `deny`
  wins. No deny/redirect ping-pong — context-mode allows the exact `cctools …`
  commands cctools-edit recommends (only redirects `curl`/`wget`-style large
  fetches).

## Known limitations (by design — precision over recall, fail-open)
- Bash guard tolerates these **false negatives** (never wrongly blocks,
  matters more): in-place editors other than `sed -i` (`perl -i`,
  `awk -i inplace`, `ed`/`ex`), bare readers other than `cat` (`tac`/`head`/
  `tail`/`less`), interpreter `open(…, "w")` one-liners, any file op hidden past
  2048-char command cap, unusual `cat` redirect forms whose raw view
  escapes whole-command bare-cat check (`cat<f` with redirect glued to
  command word; `cat < f 2>/dev/null`, where stderr redirect trips
  detector's "stdout not raw to model" bail). Native `Write`/`Edit` of these
  files still caught by redirect hook, and `perl -i` etc. preserve raw
  bytes unless explicit UTF-8 layer requested.
- Input redirects are READS: `cmd < legacy` denied ONLY for bare `cat`
  view (`cat < f`) that dumps raw bytes to model. For any other command
  (`grep < f`, `wc < f`, `sed -i SCRIPT < f`, `tee < f`) it feeds stdin to
  processor whose *output* — not file — reaches model, never mutates
  file, so allowed (blocking = false positive).
- Guard is *secondary* net; redirect hook + SessionStart priming are
  primary encoding protection.

## Tests
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/cctools-edit/
```
`test/cctools-edit/test.bats` (bats). Hermetic — no network: dummy executable
stands in for binary, `--print-asset`/`--print-url` cover OS/arch
mapping, `CCTOOLS_SKIP_INSTALL=1` keeps SessionStart offline. Bash guard
runs against `test/cctools-edit/bash-guard-corpus.json` (84 deny/allow cases,
incl. quoting/heredoc/fd-dup/input-redirect traps) using real ISO-8859-1 vs UTF-8
fixtures; further tests cover `file`-fork memo, `bun` JSON-runtime
fallback, no-runtime warning (`bun` tests skip when bun absent).