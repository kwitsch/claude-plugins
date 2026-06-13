# Component: skill (SKILL.md)

- Live doc path: `en/skills` (`https://code.claude.com/docs/en/skills.md`).
  Resolve the exact path via `<CACHE_DIR>/llms.txt` if it has moved.
- Lives at `skills/<name>/SKILL.md`.

Scaffold skeleton (confirm CURRENT keys via cc-knowledge — do not trust this list
blindly):

```yaml
---
name: <kebab-name>
description: <what it does + when to use it>
---
```

Gotchas to check:
- `name` should match the skill directory name.
- `disable-model-invocation: true` is for user-only wizards (e.g. `configure-*`);
  omit it for normal operational skills.
- Keep `description` within the documented length cap; verify the cap via the doc.
