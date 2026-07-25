# superpowers-automation

A `new-work` orchestrator that classifies a one-line description as a feature, fix, or refactor, then drives the matching superpowers pipeline. Feature/refactor runs brainstorm -> review spec -> write plan -> review plan -> implement, with advisor-driven file revision at the spec and plan stages; fix runs `systematic-debugging` to completion. The branch is prefixed by type (`feature/`, `fix/`, `refactor/`).

Also ships the `file-advisor-improver` skill (forked Sonnet; reviews a file via `advisor()` and revises it in place) and a single opt-in `PostToolUse:Write` hook that forces Subagent-Driven implementation after a plan is written. The hook defaults off.

## Install

```
/plugin install superpowers-automation@kwitsch-plugins
```

Depends on the `superpowers` plugin (`claude-plugins-official`), whose `brainstorming`, `systematic-debugging`, `writing-plans`, and `subagent-driven-development` skills the `new-work` pipeline invokes.

## Skills

| Skill                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configure-superpowers-automation` | Interactive wizard to enable/disable the plans hook. Writes only non-default values to `~/.claude/settings.json`.                                                                                                                                                                                                                                                                                                                                    |
| `new-work`                         | Classifies a description as feature/fix/refactor, derives a type-prefixed branch and creates it (via `branch-management:new-branch` or git), then runs the matching process skill: feature/refactor -> brainstorming -> `file-advisor-improver` (spec) -> writing-plans -> `file-advisor-improver` (plan) -> subagent-driven-development (each stage's auto-handoff suppressed so the reviser steps run); fix -> systematic-debugging to completion. |
| `file-advisor-improver`            | Forked (Sonnet) clean-room review of one file passed by path via `advisor()`, then revises that file in place to implement the feedback. Warns and skips if the file is missing or `advisor` is unavailable.                                                                                                                                                                                                                                         |

## Configuration

Run `/configure-superpowers-automation` to enable/disable hooks interactively. Manual editing via `settings.json` is also supported using the table below.

Options stored under `pluginConfigs["superpowers-automation@kwitsch-plugins"].options`.

| Option       | Default | Effect / Value                                                                                                                                                          |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hook_plans` | `false` | `true` = on writing `docs/superpowers/plans/*.md`, inject an instruction to implement the plan with `superpowers:subagent-driven-development` (forcing Subagent-Driven) |
