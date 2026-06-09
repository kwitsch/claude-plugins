# superpowers-automation

Packages two PostToolUse Write hooks from the superpowers workflow as individually-toggled plugin options. All features default to off.

## Hooks

| Hook | Trigger | Injected message |
|---|---|---|
| Plans hook | Write to `docs/superpowers/plans/*.md` | "Use approach: 1. Subagent-Driven." |
| Specs hook | Write to `docs/superpowers/specs/*.md` | "User has reviewed and confirmed the spec. Proceed after self-review." |

## Setup

Run `/configure-superpowers-automation` to enable/disable hooks interactively.

Options are stored in `~/.claude/settings.json` under
`pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.
