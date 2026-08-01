# kiwi-code-style

Ships the kiwi-code-style output style and a SessionStart hook that injects
the karpathy-ponytail coding guidelines — both enforced whenever this plugin
is enabled.

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

A `SessionStart` hook (`hooks/`) injects the
[karpathy-ponytail](https://github.com/AbdullahHameedKhan/karpathy-ponytail-skills/blob/main/skills/karpathy-ponytail/SKILL.md)
coding guidelines — think before coding, a 7-rung simplicity ladder, surgical
changes, root-cause bug fixes, goal-driven execution — as `additionalContext`
on every session start, resume, `/clear`, and `/compact`. Reduced to a single, fixed
`full` intensity (no lite/ultra variants, no runtime switch); kiwi-code-style
governs response _form_, ponytail governs _behavior_, so when both apply, say
the ponytail thing in kiwi's shape.

## Notes

- No skills/agents — this plugin has two fixed, always-on components: the
  output style and the SessionStart hook.
- No `userConfig`: both components are the entire plugin's fixed opinionated
  contract; there's nothing to toggle independently of enabling/disabling the
  plugin itself.
- Style changes take effect after `/clear` or a new session (system prompt is
  read once at session start) — same as any output style. The hook's
  guidelines re-inject on `/clear`/`/compact` too, since both wipe context.
