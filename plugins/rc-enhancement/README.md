# rc-enhancement

SessionStart hook that injects one critical must-follow rule: all user
interaction goes through the `AskUserQuestion` tool — never end a turn with a
plain-text question, and capture free-text answers via the tool's Other option
alongside an Abort/Cancel option.

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

- **Context injection only, not enforced.** The rule is advisory context; no
  `Stop`/`PreToolUse` hook mechanically blocks a turn that ends in a plain-text
  question. A future enforcement hook is a scoped follow-up.
- **Always on, no toggle.** There is no `userConfig` — this is a single fixed
  contract. Enable the plugin or don't.
