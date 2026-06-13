# CLAUDE.md — cave-context

Unifies caveman + context-mode into one plugin: a hooks component (stub, ready for hook entries) and a skills component (cave-context skill).

## Behavior

The `hooks/hooks.json` is currently a stub with no active hook entries. Populate it with real `PreToolUse`/`PostToolUse` matchers and corresponding scripts under `plugins/cave-context/hooks/` to aggregate caveman and context-mode hook behavior. The `skills/cave-context/SKILL.md` describes how to use the unified plugin.

## Tests

`test/cave-context/test.bats` (bats). Run: `BATS_LIB_PATH=/usr/lib/bats bats test/cave-context/`.
