---
description: Convention for skill invocation control — configure-* skills are user-only; all other skills default to user + model invocable.
globs: ["plugins/*/skills/**/SKILL.md", "plugins/*/SKILL.md"]
---

# Rule: Skill invocation control

## configure-* skills — user-only

Skills whose directory name starts with `configure-` are interactive configuration wizards. They prompt the user interactively via `AskUserQuestion` and write to settings files. They **must not** be auto-invoked by the model.

**Requirement:** every `configure-*/SKILL.md` must carry `disable-model-invocation: true` in its frontmatter.

```yaml
disable-model-invocation: true
```

## All other skills — user + model invocable

Skills not named `configure-*` are operational skills that the model may invoke automatically when relevant. Do **not** add `disable-model-invocation: true` to them unless there is an explicit reason (e.g. deploy, destructive side effects, send-message).

## Reference

| Frontmatter | User invoke | Model auto-invoke |
|---|---|---|
| _(none)_ | ✓ | ✓ |
| `disable-model-invocation: true` | ✓ | ✗ |
| `user-invocable: false` | ✗ | ✓ |
