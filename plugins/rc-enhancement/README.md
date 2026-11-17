# rc-enhancement

Interaction contract: a `SessionStart` hook injects the critical rule that all user interaction goes through the `AskUserQuestion` tool (never a plain-text question; free-text answers via Other plus an Abort/Cancel option), and a `Stop` hook blocks a main-session turn once when it still ends in a plain-text question, pointing back at that rule.

## Install

```text
/plugin install rc-enhancement@kwitsch-plugins
```

## What it does

- **Session rule.** A `SessionStart` command hook with no matcher (so it fires on startup, resume, `/clear` and `/compact`, each of which wipes context the same way) answers the `CRITICAL RULE` as a hook JSON object (`additionalContext`), which Claude Code adds as session context before Claude acts. The rule mandates: every user interaction goes through `AskUserQuestion`, a turn never ends on a plain-text question mark, a free-text question still uses the tool with an `Abort/Cancel` option, and the free-text answer is captured through the tool's `Other` option. An `Output format` section adds: no self-answered questions ("Why is that? Because ..."); write a heading line ending in a colon followed by a bullet list instead.
- **Interaction gate.** A `Stop` command hook checks the final answer of the main session. When its last paragraph (outside code, inline code and quotes) holds a question, a `?` followed by whitespace or the end,, it blocks the stop once with a short reason that points at the session-start rule, and Claude redoes the question through `AskUserQuestion` in the same turn. Subagents are never gated, and a stop that another Stop hook already continued is let through. A question in an earlier paragraph passes; a rhetorical `?` in the last paragraph is an accepted false positive.

## Notes

- Always on, no `userConfig`: enable the plugin or don't.
- Plain Node command hooks: no mods engine needed.
