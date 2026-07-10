# CLAUDE.md — memory-enhancement

One skill (`dream`) plus a Stop/SessionStart command-hook pair that
auto-nudges it, replicating an "auto-dream" style consolidation cycle on top
of Claude Code's native auto-memory feature (v2.1.59+).

## Behavior

- `hooks/flag-dream-due.mjs` (`Stop`, command): unconditionally
  touches/refreshes `${CLAUDE_PLUGIN_DATA}/dream-due-<hash>.flag`, where
  `<hash>` is the first 8 hex chars of `sha256(realpath(${CLAUDE_PROJECT_DIR}))`
  (mirrors `cc-compress`'s own `backupPathFor` hash-suffix idiom). No
  `user_config` read here -- gating happens once, at SessionStart.
- `hooks/check-dream-due.mjs` (`SessionStart`, command): reads `auto_dream`
  via `${user_config.auto_dream}` interpolated into `argv[2]` (documented in
  the plugins reference: "Plugin hooks/commands additionally substitute
  `${user_config.*}`") -- fail-closed, only the literal string `"true"`
  enables (state-creating-toggle exception in
  `.claude/rules/plugin-userconfig.md`: this nudge triggers a cycle that
  writes memory files). If enabled and this project's flag file exists,
  injects a natural-language `additionalContext` nudge and deletes the flag
  (consumed once, so `/clear`/`/compact` don't re-fire it).
- Both hooks use the `isMainModule()` guard idiom (copied from
  `plugins/universal-format/mcp/server.mjs`) so their exported
  `flagPathFor`/`isAutoDreamEnabled` helpers are unit-testable without
  starting the stdin read.
- `skills/dream/SKILL.md`: four phases -- orient (read the memory path from
  the session's own auto-memory system-prompt block, never recomputed),
  gather signal (targeted `rg` over the most recent 8 main-session `*.jsonl`
  transcripts -- never a full read), consolidate (merge/drop/resolve, sibling
  `.bak` backup before writing, then `Skill(claude-code-knowledge:cc-compress)
  --confirmed` on every touched non-MEMORY.md file), update the MEMORY.md
  index (kept under 200 lines/25KB, written directly -- never passed through
  `cc-compress`, whose path-preservation regex doesn't protect its
  bare-filename links).

## Tests

`test/memory-enhancement/test.bats` (bats) + `test/memory-enhancement/hooks.test.mjs`
(`node --test`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/memory-enhancement/
npm run test:unit
npm run typecheck
```
