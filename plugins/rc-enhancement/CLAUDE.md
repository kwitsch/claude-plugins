# CLAUDE.md — rc-enhancement

Hooks-only plugin. One fixed, always-on component: a `SessionStart` command
hook that injects a single CRITICAL interaction rule. No skills/agents, no
`userConfig`.

## Behavior

See `plugins/rc-enhancement/hooks/CLAUDE.md` for the `SessionStart` hook design.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/rc-enhancement/
```

The version-pin test is a **rolling pin**: it asserts the exact
`plugin.json` version (`0.1.0`). Any future version bump MUST update that
assertion in the same commit, or CI turns red.
