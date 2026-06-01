# CLAUDE.md — git-sign-key

Two hooks that make `git commit` sign with a key file at `~/.claude/sign.key`
(SSH signing) instead of the ssh-agent.

## Behavior
- `hooks/sign-commits.sh` (PreToolUse, matcher `Bash`): when `~/.claude/sign.key`
  exists, injects `-c gpg.format=ssh -c user.signingkey='<abs-key>' -c
  commit.gpgsign=true` right before the `commit` subcommand and returns it via
  `hookSpecificOutput.updatedInput` (`permissionDecision: allow`).
- `hooks/check-sign-key.sh` (SessionStart): when the key file is missing, emits
  an `additionalContext` warning with the setup steps; silent when it exists.
- Gate: matches `git commit` only as a subcommand — followed by a space or the
  end of the string — so `git commit-tree`, `git committed`, and the word
  "commit" inside a message are left alone. Only the first occurrence is
  rewritten.
- Guards: the command is rebuilt by string concatenation (not `${var/.../...}`)
  so `&`/`\` in `$HOME` stay literal in the injected path; the path is
  single-quoted so spaces survive; runs `bash -n` and fails open on broken
  syntax. No idempotency check is needed — an already-wired `git -c … commit`
  contains no literal `git commit ` and is filtered by the gate.
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
