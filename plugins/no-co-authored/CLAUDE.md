# CLAUDE.md — no-co-authored

A PreToolUse hook (`hooks/deny-coauthor.sh`, matcher `Bash`) that scans
`git commit` commands and **denies** them when the message carries a co-author
trailer or the Claude Code footer. Scan only — it never rewrites the command.

## Behavior
- Pure shell `case` matching on the raw hook payload; no `jq`/`node` dependency. `Co-Authored-By:` and `Generated with [Claude Code](http` are plain ASCII that JSON never escapes, so they match verbatim in the payload.
- Scope guard: only payloads containing `git commit` are considered; everything else exits 0 with no output.
- Findings (case-insensitive trailer; footer matched by its full `[Claude Code](http` signature so prose mentioning the footer survives): returns `permissionDecision: "deny"` with a `permissionDecisionReason` that names what was found and tells Claude to recreate the commit without those lines.
- Fails open (exit 0, no output) for clean commits, non-commit commands, and malformed input. The deny `reason` is hand-assembled into JSON, so it stays JSON-safe (plain ASCII, no double quotes/backslashes/newlines).

## Tests
`test/no-co-authored/test.bats` (bats). Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/no-co-authored/`.
