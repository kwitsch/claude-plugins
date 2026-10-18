# CLAUDE.md — memory-enhancement

Two skills (`dream`, `self-improvement`) plus a mods hooks module
(`turn.complete` / `session.start`) that auto-nudges `dream`, replicating an
"auto-dream" style consolidation cycle on top of Claude Code's native
auto-memory feature (v2.1.59+).

## Behavior

- `hooks/hooks.json` = `{"modules": ["./register.ts"]}`; `hooks/register.ts`
  holds every hook and `$` use, `hooks/dream.mjs` the pure zero-dep logic —
  see `plugins/memory-enhancement/hooks/CLAUDE.md` for design detail. Module
  rules (typing, no `$` in the `.mjs`, `.claude-plugin/types/` gitignored)
  follow `plugins/inline-headroom/CLAUDE.md`.
- The dream-due flag lives in `$.store` since 0.5.0. Deliberate one-time
  migration loss: 0.4.x `dream-due-*.flag` files under `CLAUDE_PLUGIN_DATA`
  are ignored, so a project flagged before the upgrade misses at most one
  nudge (details: `hooks/CLAUDE.md`).
- `skills/dream/SKILL.md` — the four-phase consolidation procedure; see
  `plugins/memory-enhancement/skills/dream/CLAUDE.md` for cross-file design rationale not in the skill body.
- `skills/self-improvement/SKILL.md` — see
  `plugins/memory-enhancement/skills/self-improvement/CLAUDE.md` for design detail.

## Tests

`test/memory-enhancement/test.bats` (bats: manifest/structure, plus
`claude plugin validate`/`test` when `claude` is on PATH),
`test/memory-enhancement/dream.test.mjs` (`node --test`, pure logic incl. the
0.4.x-identical project hash) and `plugins/memory-enhancement/tests/memory-enhancement.test.ts`
(hook wiring, `claude plugin test`, local only). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/memory-enhancement/
pnpm run test:unit
pnpm run typecheck
claude plugin validate plugins/memory-enhancement && claude plugin test plugins/memory-enhancement
```
