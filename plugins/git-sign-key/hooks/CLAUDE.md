# CLAUDE.md — git-sign-key/hooks

Event wiring, injected flag set and control flow live in `hooks.json` and the header comments of `sign-commits.sh` / `check-sign-key.sh`. Only rationale and pitfalls are kept here.

## `sign-commits.sh` (PreToolUse, `Bash`)

- Injects the signing flags right after the `git` token of every commit invocation when `~/.claude/sign.key` exists; returns them via `hookSpecificOutput.updatedInput` (`permissionDecision: allow`).
- Pin `gpg.ssh.program=ssh-keygen`:
  - A custom global `gpg.ssh.program` (1Password `op-ssh-sign`, etc.) would otherwise receive the on-disk key path, which it cannot read.
  - With `commit.gpgsign=true` forced, that makes the commit fail.
- Keep the scanner (`_rewrite`) quote-aware:
  - It rewrites every `git` at an unquoted command position, so `a && b` and `$(…)`/backticks are signed and quoted text is left untouched.
  - A separator inside a quoted arg (e.g. `-m "fix; git commit later"`) must not count as a command position — that would inject flags into the literal and still pass `bash -n`.
- `_is_commit_invocation` skips global options (`-C <path>`, `-c k=v`, `--long`) to reach the subcommand and requires a right boundary after `commit`, so `commit-tree`/`committed` never match.
- Idempotency via `MARKER=user.signingkey='<key>'`; an already-wired command sets `ALREADY=1` and is skipped.
  - The marker is the signing-key flag, not `gpg.ssh.program`: matching the latter would skip a real commit where the user pinned ssh-keygen themselves.
- Build the flag string by concatenation, not `${var/.../...}`, so `&`/`\` in `$HOME` stay literal; single-quote the key path so spaces survive.
- `_rewrite` writes the global `REWRITTEN` instead of using command substitution, so trailing newlines survive.
- Pure bash (no `grep`). `local s=$1; local n=${#s}` stays split so `${#s}` is not expanded before `s` is bound under `set -u`.
- JSON is read via `jq` (`.tool_input.command | strings`), falling back to `node`.

## `check-sign-key.sh` (SessionStart)

- Warns via static JSON (needs neither `jq` nor `node`) when the key is missing, or when an existing key cannot sign non-interactively (passphrase-encrypted or unsafe permissions).
- Warns only on positive `ssh-keygen` stderr signals, so a dummy/invalid key file stays silent.

## Fail-open stance

- Missing key, non-commit or non-string command, no `jq`/`node`, unparseable input, or a rewrite that fails `bash -n` all exit 0 with no output — the hook never blocks a commit.
- Once the key is present, `commit.gpgsign=true` means git itself fails the commit if signing cannot complete (see the README).
