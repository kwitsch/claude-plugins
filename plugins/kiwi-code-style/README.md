# kiwi-code-style

Ships the kiwi-code-style output style: a machine-optimized, emoji-legend
response format enforced whenever this plugin is enabled.

## Install

```
/plugin install kiwi-code-style@kwitsch-plugins
```

## What it does

Registers the `kiwi-code-style` output style (`output-styles/kiwi-code-style.md`).
`force-for-plugin: true` auto-applies it whenever this plugin is enabled, overriding
any output style the user has picked via `/config` — no manual activation step.
`keep-coding-instructions: true` keeps Claude Code's built-in software-engineering
instructions (change-scoping, comments, verification) active alongside the style;
only response formatting/communication changes, not coding behavior.

The style enforces: silence-by-default interim messages, a closed 8-emoji status
legend, numbered plans with no emojis, dash-bulleted headed summaries, hard
per-line word/clause caps, digits-only numbers, indented sub-bullets for status
lines with 2+ attributes, and an `AskUserQuestion`-first input protocol with a
fixed turn-end contract (a pending question, or a final `Summary:` block). See
`output-styles/kiwi-code-style.md` for the full contract.

## Notes

- No skills/agents/hooks — this plugin has exactly one component.
- No `userConfig`: the style is the entire plugin; there's nothing to toggle
  independently of enabling/disabling the plugin itself.
- Style changes take effect after `/clear` or a new session (system prompt is
  read once at session start) — same as any output style.
