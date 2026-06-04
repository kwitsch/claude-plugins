# CLAUDE.md — git-sign-key

Two hooks that make `git commit` sign with a key file at `~/.claude/sign.key`
(SSH signing) instead of the ssh-agent.

## Behavior
- `hooks/sign-commits.sh` (PreToolUse, matcher `Bash`): when `~/.claude/sign.key`
  exists, inserts `-c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c
  user.signingkey='<abs-key>' -c commit.gpgsign=true` right after the `git` token
  of every commit invocation and returns it via `hookSpecificOutput.updatedInput`
  (`permissionDecision: allow`). `gpg.ssh.program=ssh-keygen` pins the built-in
  signer so a custom global `gpg.ssh.program` (1Password `op-ssh-sign`, etc.) is
  bypassed — without it git would hand the on-disk key path to that program,
  which can't read it, and the forced-signed commit would fail.
- `hooks/check-sign-key.sh` (SessionStart): warns (static JSON) when the key file
  is missing (setup steps) OR when an existing key is passphrase-encrypted
  (`ssh-keygen -y -f key -P '' </dev/null` stderr matches `passphrase`/`decrypt`)
  — only `ssh-keygen` is needed; a dummy/invalid file stays silent.
- Scanner (replaces the old first-`git commit ` `case`): `_rewrite` walks the
  command char-by-char tracking single/double-quote and backslash state, and
  rewrites **every** `git` reached at an **unquoted command position** — start of
  string or after an unquoted separator (`_is_cmd_start`: `;`&`|`(`{`` ` ``/
  newline) via a `cmd_pos` flag. Quote-awareness is what stops a separator
  *inside* a quoted commit message/arg (e.g. `-m "fix; git commit later"`) from
  being mistaken for a command position — that case would otherwise inject flags
  into the literal and still pass `bash -n`. This signs all real commits in
  `a && b` and inside `$(…)`/backticks, and leaves quoted text untouched.
  `_is_commit_invocation` walks global options (`-C <path>`/`-c k=v` consume a
  value token; `--long[=v]` don't; bare `-`/`--` reject) to the `commit`
  subcommand, requiring a right boundary (whitespace/`;`&`|`)`}`<`>`` ` ``/end)
  so `commit-tree`/`committed` are excluded.
- Guards: flags built by concatenation (not `${var/.../...}`) so `&`/`\` in
  `$HOME` stay literal; path single-quoted so spaces survive; `bash -n` fails
  open on broken syntax. Idempotent via `MARKER=user.signingkey='<key>'` (the
  distinctive injected flag — matching just `gpg.ssh.program` would skip a real
  commit where the user pinned ssh-keygen themselves); an already-wired command
  sets `ALREADY=1` and is skipped. `_rewrite` writes the global `REWRITTEN` (no
  command substitution, so trailing newlines survive).
- Pure-bash scanner (no `grep`); `local s=$1; local n=${#s}` is split so `${#s}`
  isn't expanded before `s` is bound under `set -u`.
- Fail-open everywhere: missing key, non-commit/non-string command, no jq/node,
  or unparseable input all exit 0 with no output — the hook never blocks a
  commit. (Once the key is present, `commit.gpgsign=true` means git itself
  fails the commit if signing can't complete — see the README.)
- JSON read/emit prefers `jq` (`.tool_input.command | strings`), falls back to
  `node`; SessionStart needs neither (static JSON).

## Tests
`test/git-sign-key/test.bats` (bats). The suite isolates `$HOME` to a temp dir
to control `~/.claude/sign.key`. Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/git-sign-key/`.
