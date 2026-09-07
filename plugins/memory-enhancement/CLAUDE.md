# CLAUDE.md — memory-enhancement

Two skills (`dream`, `self-improvement`) plus a Stop/SessionStart
command-hook pair that auto-nudges `dream`, replicating an "auto-dream"
style consolidation cycle on top of Claude Code's native auto-memory
feature (v2.1.59+).

## Behavior

- `hooks/flag-dream-due.mjs` (`Stop`) and `hooks/check-dream-due.mjs`
  (`SessionStart`) — see `plugins/memory-enhancement/hooks/CLAUDE.md` for design detail.
- `skills/dream/SKILL.md` — the four-phase consolidation procedure; see
  `plugins/memory-enhancement/skills/dream/CLAUDE.md` for cross-file design rationale not in the skill body.
- `skills/self-improvement/SKILL.md` — see
  `plugins/memory-enhancement/skills/self-improvement/CLAUDE.md` for design detail.

## Tests

`test/memory-enhancement/test.bats` (bats) + `test/memory-enhancement/hooks.test.mjs`
(`node --test`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/memory-enhancement/
pnpm run test:unit
pnpm run typecheck
```
