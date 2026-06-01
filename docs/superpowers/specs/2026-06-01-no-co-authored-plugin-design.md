# Design: `no-co-authored` Plugin

**Date:** 2026-06-01
**Status:** Approved
**Branch:** `feat/no-co-authored-plugin`

## Summary

A Claude Code plugin that, once installed, registers a **PreToolUse hook on the
Bash tool**. When Claude is about to run a `git commit` with an inline message,
the hook strips `Co-Authored-By:` trailers and the Claude Code footer from the
message and rewrites the command in place — before it executes.

## Goal

Keep commit messages free of co-author trailers and bot signatures
automatically, without the user having to remember to remove them and without
blocking or breaking any commit.

## Architecture

A single PreToolUse hook matching the `Bash` tool. The hook invokes a Bash
script that:

1. Receives the planned tool call as JSON on stdin.
2. Detects whether the command is a `git commit` carrying an inline message.
3. Removes the offending lines from the command string.
4. Returns the cleaned command via `updatedInput` with
   `permissionDecision: "allow"`, so the rewritten commit runs without a further
   prompt.

This in-place rewrite is confirmed by Claude Code's documented PreToolUse
`updatedInput` capability — no block-and-retry workaround is required.

### Confirmed hook contract

- **stdin** (received by the hook):
  ```json
  {
    "tool_name": "Bash",
    "tool_input": { "command": "git commit -m '…'", "description": "…" },
    "cwd": "/path", "hook_event_name": "PreToolUse"
  }
  ```
- **stdout** (returned by the hook, exit 0):
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "updatedInput": { "command": "<cleaned command>" },
      "additionalContext": "Removed Co-Authored-By / footer lines from the commit message."
    }
  }
  ```
  `updatedInput` replaces the entire input object, so unchanged fields
  (`description`, `timeout`, `run_in_background`) must be carried over when
  present.

## Directory layout

```
plugins/no-co-authored/
├── .claude-plugin/
│   └── plugin.json            # name, version, description, author
└── hooks/
    ├── hooks.json             # PreToolUse → Bash → strip-coauthor.sh
    ├── strip-coauthor.sh      # the rewrite logic
    └── test/
        └── run-tests.sh       # fixture-based tests, no bats dependency
```

Plus a new entry in the `plugins` array of `.claude-plugin/marketplace.json`.

### `hooks.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/strip-coauthor.sh"
          }
        ]
      }
    ]
  }
}
```

The matcher is the broad `Bash` tool; the git-commit detection lives inside the
script (more robust than relying on the optional `if` matcher field, which may
not exist in every Claude Code version).

### Marketplace entry

```json
{
  "name": "no-co-authored",
  "source": "./plugins/no-co-authored",
  "description": "Strips Co-Authored-By trailers and the Claude Code footer from git commit messages before they run.",
  "version": "0.1.0",
  "author": { "name": "Kwitsch" },
  "category": "git",
  "tags": ["git", "hooks", "commit"]
}
```

## Data flow

1. Claude is about to run `git commit …` → PreToolUse fires.
2. `strip-coauthor.sh` reads the JSON from stdin and extracts
   `tool_input.command` via `jq`.
3. **Not a `git commit`** → `exit 0` with no output (normal flow).
4. Clean the command string line by line:
   - drop lines that (after optional leading whitespace, case-insensitive) start
     with `Co-Authored-By:`
   - drop the Claude footer (`🤖 Generated with …` / `Generated with [Claude Code]`)
   - collapse the blank lines that removal leaves behind (no dangling trailing
     blank line in the message body)
5. **Nothing changed** → `exit 0` with no output. This is critical: a clean
   commit must NOT be auto-allowed, so the hook only emits `allow` when it
   actually rewrote something.
6. **Changed** → `jq` builds the JSON output with `permissionDecision: "allow"`,
   `updatedInput.command` = cleaned command, and an `additionalContext` note for
   Claude. `exit 0`.

## Error handling — fail-open principle

The plugin must **never** block or corrupt a commit. On any doubt the script
exits 0 with no output, so the original command runs unchanged:

- `jq` not installed
- stdin not parseable as JSON
- unexpected / unrecognized command shape

## Scope and assumptions (deliberately out of scope)

- `git commit` **without** `-m` (opens an editor) and `git commit -F <file>`:
  the message is not present in the command string, so the hook cannot see or
  clean it → passed through unchanged.
- **All** `Co-Authored-By:` lines are removed, not just Claude's — matching the
  user's "commits without co-author line" preference. (If real human
  co-authors should be preserved, the matcher would filter only bot addresses;
  not part of this version.)

## Testing (TDD)

A lightweight `hooks/test/run-tests.sh` that feeds JSON fixtures into the hook
script and compares output. No external test framework (`bats` not guaranteed
to be installed). Cases:

1. Heredoc commit with Co-Authored-By + footer → expect cleaned `updatedInput`.
2. Inline `git commit -m "…" -m "Co-Authored-By: …"` → expect the co-author
   `-m` argument removed.
3. Clean commit (no trailers) → expect **no output** (exit 0).
4. Non-commit Bash command (`ls`) → expect no output.
5. Simulated missing `jq` → fail-open, no output.

Tests are written **first**.

## CI and branch

The existing `.github/workflows/ci.yml` validates the marketplace manifest and
plugin manifests automatically; the new marketplace entry is covered with no CI
changes required. (Optionally, the hook tests could be wired into CI later.)

Work happens on the feature branch `feat/no-co-authored-plugin`, branched from
`main` (which already carries the spec-compliant `plugins/` layout).
