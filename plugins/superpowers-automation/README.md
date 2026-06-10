# superpowers-automation

Packages two PostToolUse Write hooks from the superpowers workflow as individually-toggled plugin options, with an optional advisor review gate. All features default to off.

## Install

```
/plugin install superpowers-automation@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `configure-superpowers-automation` | Interactive wizard to enable/disable hook behaviors and the advisor review gate. Writes only non-default values to `~/.claude/settings.json`. |

## Configuration

Run `/configure-superpowers-automation` to enable/disable hooks interactively. Manual editing via `settings.json` is also supported using the table below.

Options stored under `pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.

| Option | Default | Effect / Value |
|---|---|---|
| `hook_plans` | `false` | `true` = inject "Use approach: 1. Subagent-Driven." when writing `docs/superpowers/plans/*.md` |
| `hook_specs` | `false` | `true` = inject "User has reviewed and confirmed the spec. Proceed after self-review." when writing `docs/superpowers/specs/*.md` |
| `hook_advisor_review` | `false` | `true` = append advisor() gate to any active hook's message |
