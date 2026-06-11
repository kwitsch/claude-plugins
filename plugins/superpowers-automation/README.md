# superpowers-automation

A `new-feature` orchestrator that drives the full superpowers pipeline from a one-line description (create branch -> brainstorm -> review spec -> write plan -> review plan -> implement), with advisor-driven file revision at the spec and plan stages. Ships the `file-advisor-improver` skill (forked Sonnet; reviews a file via `advisor()` and revises it in place) and a single opt-in `PostToolUse:Write` hook that forces Subagent-Driven implementation after a plan is written. The hook defaults off.

## Install

```
/plugin install superpowers-automation@kwitsch-plugins
```

Depends on the `superpowers` plugin (`claude-plugins-official`), whose `brainstorming`, `writing-plans`, and `subagent-driven-development` skills the `new-feature` pipeline invokes.

## Skills

| Skill | What it does |
|---|---|
| `configure-superpowers-automation` | Interactive wizard to enable/disable the plans hook. Writes only non-default values to `~/.claude/settings.json`. |
| `new-feature` | Orchestrates the full superpowers pipeline for one feature: derives a `feature/` branch and creates it (via `branch-management:new-branch` or git), then runs brainstorming -> `file-advisor-improver` (spec) -> writing-plans -> `file-advisor-improver` (plan) -> subagent-driven-development, suppressing each stage's auto-handoff so the reviser steps run. |
| `file-advisor-improver` | Forked (Sonnet) clean-room review of one file passed by path via `advisor()`, then revises that file in place to implement the feedback. Warns and skips if the file is missing or `advisor` is unavailable. |

`file-advisor-improver` warns and skips if the `advisor` tool is unavailable.

## Configuration

Run `/configure-superpowers-automation` to enable/disable hooks interactively. Manual editing via `settings.json` is also supported using the table below.

Options stored under `pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.

| Option | Default | Effect / Value |
|---|---|---|
| `hook_plans` | `false` | `true` = on writing `docs/superpowers/plans/*.md`, inject an instruction to implement the plan with `superpowers:subagent-driven-development` (forcing Subagent-Driven) |
