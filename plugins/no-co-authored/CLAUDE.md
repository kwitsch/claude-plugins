# CLAUDE.md — no-co-authored

A PreToolUse hook (`hooks/strip-coauthor.sh`, matcher `Bash`) that rewrites
`git commit` commands to drop co-author/footer lines before they run.

## Behavior
- JSON read/emit prefers `jq`, falls back to `node`; if neither exists it returns a `deny` decision for git commits only (telling Claude to recreate the message without those lines) and fails open for any other command.
- Cleaning (sed, case-insensitive): own-line `Co-Authored-By:`, inline `-m "Co-Authored-By: …"` args, and the footer matched by its full `[Claude Code](http…` signature (so prose mentioning the footer survives).
- Guards: never deletes a line containing `git commit`; runs `bash -n` on the result and falls open if cleaning broke the shell syntax; only emits a decision when something actually changed.

## Tests
`test/no-co-authored/test.bats` (bats). Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/no-co-authored/`.
