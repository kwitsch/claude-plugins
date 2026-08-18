# CLAUDE.md — rc-enhancement

Hooks-only plugin. One fixed, always-on component: a `SessionStart` command
hook that injects a single CRITICAL interaction rule. No skills/agents, no
`userConfig`.

## Behavior

`hooks/hooks.json` declares one `SessionStart` group with **no `matcher`** —
it fires on `startup`/`resume`/`clear`/`compact` alike, because `/clear` and
`/compact` wipe context exactly like a fresh startup and the rule must
re-inject there too. The group's single hook is a bare `cat` command hook:
`cat ${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md` with `timeout: 5`. Its raw
stdout is injected as additional session context. `SessionStart` is a
command-hook-only event (an `mcp_tool` hook hard-errors pre-connect), so `cat`
— not an `.mjs` reader — is the correct type; the content is static and
injected verbatim, so no transform script is warranted.

`hooks/SessionStart.md` and `hooks/hooks.json` are committed `100644` (NOT
executable) — the `cat`-ed markdown is the documented exec-bit exception; it
is read, never run.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/rc-enhancement/
```

The version-pin test is a **rolling pin**: it asserts the exact
`plugin.json` version (`0.1.0`). Any future version bump MUST update that
assertion in the same commit, or CI turns red.
