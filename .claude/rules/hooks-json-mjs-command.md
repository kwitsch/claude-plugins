---
paths:
  - "plugins/*/hooks/hooks.json"
---

# Rule: .mjs hooks need no node invocation in command

`.mjs` hook files are executable (see hooks-executable rule) and are invoked directly by Claude Code. Do NOT prefix them with `node`.

**Correct:**

```json
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs" }
```

**Wrong:**

```json
{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs" }
```

When writing or reviewing `hooks.json`, remove any leading `node` (or `node --input-type=module`) from `.mjs` command entries.
