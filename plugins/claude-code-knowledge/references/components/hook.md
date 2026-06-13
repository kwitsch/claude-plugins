# Component: hook (hooks.json / plugin.json hooks)

- Live doc path: `en/hooks` (`https://code.claude.com/docs/en/hooks.md`).
  Resolve via `<CACHE_DIR>/llms.txt` if it has moved.

Scaffold skeleton (confirm CURRENT schema via cc-knowledge — do not trust this list blindly):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "<ToolName>", "hooks": [ { "type": "command", "command": "<cmd>" } ] }
    ]
  }
}
```

Gotchas to check (verify each via cc-knowledge / live docs — do not trust blindly):
- Only `PreToolUse`/`PostToolUse` take a `matcher`.
- `mcp_tool` handlers can decide ONLY via returned JSON (no exit-code-2 block);
  for a hard gate use a `command` hook.
- `mcp_tool` is unreliable at SessionStart (server not connected yet) — use a
  `command` hook there.
- For Task/Agent redirects, the reliable path is `updatedInput` +
  `permissionDecision:"allow"`; exit-2 blocking is buggy for that path. Confirm
  the current schema via the doc.
