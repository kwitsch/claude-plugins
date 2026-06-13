# Component: agent (subagent)

- Live doc path: `en/sub-agents` (`https://code.claude.com/docs/en/sub-agents.md`).
  Resolve via `<CACHE_DIR>/llms.txt` if it has moved.
- Lives at `agents/<name>.md`.

Scaffold skeleton (confirm CURRENT keys via cc-knowledge — do not trust this list blindly):

```yaml
---
name: <kebab-name>
description: <when this subagent should be used>
---
```

Gotchas to check (verify each via cc-knowledge / live docs — do not trust blindly):
- Omitting `tools:` inherits all tools; declaring it restricts to the listed set
  (MCP tools then need explicit `mcp__…` entries).
- Plugin subagents are addressed by SCOPED name `plugin:agent` for `--agent` and
  for `subagent_type` in redirects.
- Plugin subagents may not support `mcpServers:` frontmatter — confirm via the doc.
