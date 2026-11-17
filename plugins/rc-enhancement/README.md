# rc-enhancement

Interaction contract: a `SessionStart` hook injects the critical rule that all user interaction goes through the `AskUserQuestion` tool (never a plain-text question; free-text answers via Other plus an Abort/Cancel option), and a mods gate re-prompts once when a turn still ends in a plain-text question, pointing back at that rule.

## Install

```text
/plugin install rc-enhancement@kwitsch-plugins
```

## What it does

- **Session rule.** A `SessionStart` command hook with no matcher (so it fires on startup, resume, `/clear` and `/compact`, each of which wipes context the same way) prints the `CRITICAL RULE`; its stdout is added as session context before Claude acts. The rule mandates: every user interaction goes through `AskUserQuestion`, a turn never ends on a plain-text question mark, a free-text question still uses the tool with an `Abort/Cancel` option, and the free-text answer is captured through the tool's `Other` option.
- **Interaction gate.** A function-hooks module watches main-loop turns. When the final answer's last line (outside code fences) ends in `?`, it submits one plugin message telling Claude to redo it through `AskUserQuestion` per the session-start rule. At most one re-prompt per turn you start; subagents are never gated. The questioning answer stays visible and the correction arrives as a separate turn. A rhetorical trailing `?` is an accepted false positive.

## Notes

- Always on, no `userConfig`: enable the plugin or don't.
- The gate needs a Claude Code version with function-hooks modules (mods); the session rule works without.
