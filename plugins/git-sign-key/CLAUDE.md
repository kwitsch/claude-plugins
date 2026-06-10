# CLAUDE.md — git-sign-key

Two hooks make `git commit` sign with key file at `~/.claude/sign.key`
(SSH signing) instead of ssh-agent.

## Setup
```bash
ssh-keygen -t ed25519 -f ~/.claude/sign.key -N ""
```
Key created at `~/.claude/sign.key` — must stay unencrypted (passphrase blocks signing).

## Behavior
- `hooks/sign-commits.sh` (PreToolUse, matcher `Bash`): when `~/.claude/sign.key`
  exists, inserts `-c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c
  user.signingkey='<abs-key>' -c commit.gpgsign=true` right after `git` token
  of every commit invocation, returns via `hookSpecificOutput.updatedInput`
  (`permissionDecision: allow`). `gpg.ssh.program=ssh-keygen` pins built-in
  signer so custom global `gpg.ssh.program` (1Password `op-ssh-sign`, etc.)
  bypassed — without it git hands on-disk key path to that program, which can't
  read it, forced-signed commit fails.
- `hooks/check-sign-key.sh` (SessionStart): warns (static JSON) when key missing
  (setup steps) OR when existing key passphrase-encrypted
  (`ssh-keygen -y -f key -P '' </dev/null` stderr matches `passphrase`/`decrypt`)
  — only `ssh-keygen` needed; dummy/invalid file stays silent.
- Scanner (replaces old first-`git commit ` `case`): `_rewrite` walks
  command char-by-char tracking single/double-quote and backslash state,
  rewrites **every** `git` at **unquoted command position** — start of
  string or after unquoted separator (`_is_cmd_start`: `;`&`|`(`{`` ` ``/
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
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/git-sign-key/
```
`test/git-sign-key/test.bats` (bats). The suite isolates `$HOME` to a temp dir
to control `~/.claude/sign.key`.