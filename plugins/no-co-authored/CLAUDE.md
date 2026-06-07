# CLAUDE.md — no-co-authored

PreToolUse hook (`hooks/deny-coauthor.sh`, matcher `Bash`) scan `git commit` commands. **Deny** when message carry co-author trailer or Claude Code footer. Scan only — never rewrite command.

## Behavior
- Pure shell `case` match on raw hook payload; no `jq`/`node` dep. `Co-Authored-By:` and `Generated with [Claude Code](http` plain ASCII, JSON never escape, so match verbatim in payload.
- Scope guard: only payloads with `git commit` considered; else exit 0, no output.
- Findings (case-insensitive trailer; footer matched by full `[Claude Code](http` signature so prose mentioning footer survives): return `permissionDecision: "deny"` with `permissionDecisionReason` naming what found, tell Claude recreate commit without those lines.
- Fails open (exit 0, no output) for clean commits, non-commit commands, malformed input. Deny `reason` hand-assembled into JSON, stays JSON-safe (plain ASCII, no double quotes/backslashes/newlines).

## Tests
`test/no-co-authored/test.bats` (bats).