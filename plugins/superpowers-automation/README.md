# superpowers-automation

Two PostToolUse Write hooks that trigger forked advisor-review skills gating the superpowers workflow: writing a spec runs `spec-advisor-review` (→ `superpowers:writing-plans`); writing a plan runs `plan-advisor-review` (→ `superpowers:subagent-driven-development`). Both hooks default off. The standalone, user-invoked `save-advisor` skill revises a target file to implement advisor feedback.

## Install

```
/plugin install superpowers-automation@kwitsch-plugins
```

Depends on the `superpowers` plugin (`claude-plugins-official`), whose `writing-plans` and `subagent-driven-development` skills the review skills hand off to.

## Skills

| Skill | What it does |
|---|---|
| `configure-superpowers-automation` | Interactive wizard to enable/disable the plans and specs hooks. Writes only non-default values to `~/.claude/settings.json`. |
| `spec-advisor-review` | Forked (haiku) review of a written spec file via `advisor()`, then hands off to `superpowers:writing-plans`. Triggered by the specs hook. |
| `plan-advisor-review` | Forked (haiku) review of a written plan file via `advisor()`, then hands off to `superpowers:subagent-driven-development`. Triggered by the plans hook. |
| `save-advisor` | Forked (Sonnet) clean-room review of a target file via `advisor()`, then revises that file to implement the feedback. User-invoked only (`/save-advisor <path>`); warns and skips if the file is missing or `advisor` is unavailable. |

The review skills warn and continue if the `advisor` tool is unavailable.

## Configuration

Run `/configure-superpowers-automation` to enable/disable hooks interactively. Manual editing via `settings.json` is also supported using the table below.

Options stored under `pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.

| Option | Default | Effect / Value |
|---|---|---|
| `hook_plans` | `false` | `true` = on writing `docs/superpowers/plans/*.md`, instruct invoking `plan-advisor-review` with the file path |
| `hook_specs` | `false` | `true` = on writing `docs/superpowers/specs/*.md`, instruct invoking `spec-advisor-review` with the file path |
