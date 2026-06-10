# superpowers-automation

Packages two PostToolUse Write hooks from the superpowers workflow as individually-toggled plugin options, with an optional advisor review gate. All features default to off.

## Install

```
/plugin install superpowers-automation@kwitsch-plugins
```

## Hooks

| Hook | Trigger | Injected message |
|---|---|---|
| Plans hook | Write to `docs/superpowers/plans/*.md` | "Use approach: 1. Subagent-Driven." |
| Specs hook | Write to `docs/superpowers/specs/*.md` | "User has reviewed and confirmed the spec. Proceed after self-review." |

When **Advisor review gate** is enabled, an advisor gate instruction is appended to any active hook's message:

> ADVISOR GATE (active): Call advisor() before proceeding. If advisor tool unavailable, skip this step and continue normally.

## Setup

Run `/configure-superpowers-automation` to enable/disable hooks interactively.

Options are stored in `~/.claude/settings.json` under
`pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.
