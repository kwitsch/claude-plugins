# CLAUDE.md — cctools-edit

Installs the [cc-tools](https://github.com/devslimbr/cc-tools) binary and routes
the native file tools through it so file encodings are preserved instead of
corrupted to UTF-8. Hook-only ("Instruct"/deny) architecture — no MCP server.

## Components
- `hooks/lib.sh` — sourced helpers: platform → release-asset mapping
  (`cctools_asset`), resolved paths (`cctools_bin`, `cctools_home`), download
  URL, and `cctools_is_legacy_file` (encoding classifier via
  `file --mime-encoding`/`iconv`; cc-tools' own detector is NOT used — it
  mislabels ASCII as ISO-8859-1). The classifier memoises per run via
  `CCTOOLS_ENC_CACHE` (set by `cctools_scan_command`) so each distinct path is
  classified — and thus forks `file` — at most once, even when a single command
  mentions it many times. All scripts share lib.sh.
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
- `hooks/guard-bash.sh` (PreToolUse, matcher `Bash`) — secondary net for shell
  file ops. A two-pass de-quoting parser (Pass A strips heredoc bodies incl.
  multiple/`<<-`/quoted delimiters; Pass B blanks quotes/`$'…'`/`$()`/backticks/
  `<()`/`>()`/escapes/comments to a sentinel) then per-segment detectors find
  `sed -i`, OUTPUT redirections (`>` `>>` `>|` `&>` `1>`), `tee`, and a bare
  `cat` view (`cat file` or `cat < file`). An INPUT redirect `< file` into any
  other (processing) command is a read whose *output* — not the file's raw
  bytes — reaches the model and never mutates the file, so it is **allowed**
  (denying it would be a false positive, the worst failure class here). Only
  **clean literal** tokens that are **existing non-UTF-8 files**
  (`cctools_is_legacy_file`) are denied. Classify+collect runs subshell-free
  (`cctools_consider`) so the per-run encoding memo survives. `--check`/`--strip`
  modes aid testing; bash-3.2 safe (no associative arrays); fast-path skips the
  parser when the command has no `>`/`<`/cat/sed/tee.

## Behavior / key rules
- **Fail-open everywhere.** The redirect denies ONLY when the binary is present
  and `--version` runs; otherwise exit 0 (native tools stay usable) so the model
  is never stranded. Same for missing curl/wget/tar/unzip, no jq/node, malformed
  input, or an unrecognised tool name.
- **Why deny+Bash solves Read corruption:** `cctools read` runs over Bash and
  its stdout returns clean UTF-8, so the model's `old_string` matches the file's
  true bytes and `cctools edit` re-encodes to the original encoding.
- JSON parse/emit prefers `jq`, then a Node-compatible runtime — `node`, or
  `bun` (which context-mode installs; the embedded snippets run byte-for-byte
  under it). With none of the three the redirect/guard fail open and SessionStart
  emits a static `systemMessage` warning so the silent-disable stays visible.
- Installer is idempotent: a runnable `$BIN` short-circuits before any download.

## Interaction with context-mode (and other sandbox/processing plugins)
- A co-installed plugin like [context-mode](https://github.com/mksglu/context-mode)
  registers its own `PreToolUse` hooks and steers the model to read/process files
  through MCP **sandbox** tools (`ctx_execute`, `ctx_execute_file`,
  `ctx_batch_execute`) instead of the native `Read`/Bash `cat`. cctools-edit's
  matchers (`Read|Write|Edit|MultiEdit`, `Bash`) do NOT cover those MCP tools, so
  a legacy-file read routed through the sandbox **bypasses** this plugin and the
  sandbox UTF-8-decodes (corrupts) the bytes. Mitigation: the SessionStart
  priming asserts cc-tools **precedence** for any non-UTF-8 file and warns that
  sandbox/`ctx_execute*` reads corrupt and bypass — the model is told to use
  `cctools read`/`edit` for legacy files regardless of other guidance. (Guard via
  guidance, not by matching context-mode's tools: denying `ctx_execute_file`
  would break context-mode and those tools discard FS writes anyway.)
- Bash-hook coexistence is correct: both plugins' `PreToolUse:Bash` hooks run as
  independent processes (each gets its own stdin copy); a cctools-edit `deny`
  wins. No deny/redirect ping-pong — context-mode allows the exact `cctools …`
  commands cctools-edit recommends (it only redirects `curl`/`wget`-style large
  fetches).

## Known limitations (by design — precision over recall, fail-open)
- The Bash guard tolerates these **false negatives** (it never wrongly blocks,
  which matters more): in-place editors other than `sed -i` (`perl -i`,
  `awk -i inplace`, `ed`/`ex`), bare readers other than `cat` (`tac`/`head`/
  `tail`/`less`), interpreter `open(…, "w")` one-liners, any file op hidden past
  the 2048-char command cap, and unusual `cat` redirect forms whose raw view
  escapes the whole-command bare-cat check (`cat<f` with the redirect glued to
  the command word; `cat < f 2>/dev/null`, where a stderr redirect trips the
  detector's "stdout not raw to the model" bail). Native `Write`/`Edit` of these
  files is still caught by the redirect hook, and `perl -i` etc. preserve raw
  bytes unless an explicit UTF-8 layer is requested.
- Input redirects are READS: `cmd < legacy` is denied ONLY for a bare `cat`
  view (`cat < f`) that dumps raw bytes to the model. For any other command
  (`grep < f`, `wc < f`, `sed -i SCRIPT < f`, `tee < f`) it feeds stdin to a
  processor whose *output* — not the file — reaches the model and never mutates
  the file, so it is allowed (blocking it would be a false positive).
- The guard is a *secondary* net; the redirect hook + SessionStart priming are
  the primary encoding protection.

## Tests
`test/cctools-edit/test.bats` (bats). Hermetic — no network: a dummy executable
stands in for the binary, `--print-asset`/`--print-url` cover the OS/arch
mapping, and `CCTOOLS_SKIP_INSTALL=1` keeps SessionStart offline. The Bash guard
runs against `test/cctools-edit/bash-guard-corpus.json` (84 deny/allow cases,
incl. quoting/heredoc/fd-dup/input-redirect traps) using real ISO-8859-1 vs UTF-8
fixtures; further tests cover the `file`-fork memo, the `bun` JSON-runtime
fallback, and the no-runtime warning (`bun` tests skip when bun is absent). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/cctools-edit/`.
