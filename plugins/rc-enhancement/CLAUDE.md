# CLAUDE.md — rc-enhancement

Mod plugin, no skills/agents, no `userConfig`. Two fixed, always-on components
that form one interaction contract:

- a `SessionStart` command hook that injects the single CRITICAL interaction rule
  (`hooks/SessionStart.md`);
- a mods function-hooks module (`hooks/register.ts` + pure `hooks/gate.mjs`): the
  interaction gate, which re-prompts once when a turn ends in a plain-text
  question. Its re-prompt (`GATE_REASON`) refers to the session-start rule, so
  keep the `CRITICAL RULE` wording in both files in sync.

The gate moved here from `coding-toolbox` (0.26.0); do not re-add it there.

## Behavior

See `plugins/rc-enhancement/hooks/CLAUDE.md` for both designs.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/rc-enhancement/
pnpm run test:unit   # test/rc-enhancement/interaction-gate.test.mjs (pure gate logic)
```

`tests/rc-enhancement.test.ts` covers the hook wiring under `claude plugin test`
(local only; CI has no `claude` CLI).

The version-pin test is a **rolling pin**: it asserts the exact
`plugin.json` version. Any future version bump MUST update that
assertion in the same commit, or CI turns red.
