# rc-enhancement

Interaction contract: a `SessionStart` hook injects the critical rule that all
user interaction goes through the `AskUserQuestion` tool (never a plain-text
question; free-text answers via Other plus an Abort/Cancel option), and a mods
gate re-prompts once when a turn still ends in a plain-text question, pointing
back at that rule.

## Install

```
/plugin install rc-enhancement@kwitsch-plugins
```

## What it does

- Registers a single `SessionStart` hook (`hooks/hooks.json`) with **no
  matcher**, so it fires on every session source — startup, resume, `/clear`,
  and `/compact` (each wipes context the same way).
- The hook runs `cat ${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md` (5s
  timeout); the file's raw markdown is injected verbatim as additional session
  context before Claude acts.
- The injected `CRITICAL RULE` mandates that all user interaction go through
  the `AskUserQuestion` tool: never end a turn on a plain-text question mark,
  always offer an `Abort/Cancel` option for free-text questions, and capture
  the free-text answer via the tool's `Other` option.

## Notes & limitations

- **Interaction gate.** A mods module (`hooks/register.ts`) watches main-loop
  turns: when the final answer's last line (outside code fences) ends in `?`,
  it submits one plugin message telling Claude to redo it via `AskUserQuestion`
  per the session-start rule. At most one re-prompt per turn you start;
  subagents are never gated. The questioning answer stays visible — the
  correction arrives as a separate turn. A rhetorical trailing `?` is an
  accepted false positive. Moved here from `coding-toolbox`.
- **Always on, no toggle.** There is no `userConfig` — this is a single fixed
  contract. Enable the plugin or don't.
