---
name: cck-hook
description: Create, validate, or adjust a Claude Code hook (hooks.json or plugin.json hooks) using current official docs. Usage: /cck-hook create | validate <path> | adjust <path>. Routes through the cc-knowledge agent so hook events, matchers, and the mcp_tool/command decision rules match the running Claude Code version, not stale training memory.
argument-hint: "create | validate <path> | adjust <path>"
---

# /cck-hook

Component type: **hook** (`hooks.json` / `plugin.json` hooks).

## Resolved context
- Cache dir (fallback compute): !`echo "${CLAUDE_PLUGIN_DATA:-UNSET}/cache-$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"`
- Shared workflow + component reference:
!`cat "${CLAUDE_PLUGIN_ROOT}/references/cck-workflow.md" "${CLAUDE_PLUGIN_ROOT}/references/components/hook.md" 2>/dev/null`

## Procedure
Run the requested mode from `$ARGUMENTS` (`create` | `validate <path>` |
`adjust <path>`) following the shared workflow above. Prefer the `CACHE_DIR`
announced in the SessionStart context; otherwise use the fallback above.
Dispatch the `cc-knowledge` agent (Agent tool, subagent_type
`claude-code-knowledge:cc-knowledge`) for the CURRENT hook schema (events,
matchers, mcp_tool vs command decision rules), passing it `CACHE_DIR`. Never
rely on training memory for hook event names or matchers.
