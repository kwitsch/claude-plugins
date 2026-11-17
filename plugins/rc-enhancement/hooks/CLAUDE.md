# CLAUDE.md — rc-enhancement/hooks

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

## Interaction gate (mods module, `turn.start` + `turn.complete`)

`hooks.json` carries `"modules": ["./register.ts"]` next to the `SessionStart`
group (`claude plugin validate` accepts both keys in one file). A main-loop turn
whose answer ends with a plain-text question gets one plugin prompt telling
Claude to redo it via `AskUserQuestion`, pointing back at the SessionStart rule.

- Heuristic (`isBareQuestion` in `gate.mjs`): strip fenced code blocks, take the last non-empty line; if it ends in `?`, gate. Blunt on purpose: a rhetorical trailing `?` is an accepted false positive.
- Only `reason === "answer"` main-loop turns (`e.agentId === undefined`); subagents, interrupted and errored turns are never gated.
- Mechanism: user-tier mods have no native Stop block (`classic.Stop` is bypassed by `cc-plugin-sec-default`). `turn.complete` calls `$.prompt.submit({ text: GATE_REASON })` unawaited: the engine queues a framed plugin prompt ("The rc-enhancement plugin sent a message: …") that starts a new turn once the session is idle. Awaiting it would wait for that turn to start, which waits for this turn to end.
- Loop guard: `turn.start` records the main-loop turn whose prompt contains `GATE_REASON` (`isGateTurn`); `turn.complete` never gates that turn, so at most one re-prompt per user turn. Backstop for a framing change the text match would miss: a submit also marks the next main-loop turn as the gate's (`gatePending`); a user prompt that starts first takes that exemption instead (at worst one missed gate). Module state: a hot reload forgets both, which at worst lets one more re-prompt through.
- The questioning answer is not suppressed: the turn ends, its answer stays visible, the correction arrives as a separate turn.
