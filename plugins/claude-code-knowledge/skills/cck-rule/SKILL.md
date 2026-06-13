---
name: cck-rule
description: Create, validate, or adjust a Claude Code path-scoped rule (.claude/rules/*.md) using current official docs. Usage: /cck-rule create | validate <path> | adjust <path>. Routes through the cc-knowledge agent so the rule's frontmatter and behavior match the running Claude Code version, not stale training memory.
argument-hint: "create | validate <path> | adjust <path>"
---

# /cck-rule

Component type: **rule** (`.claude/rules/*.md`).

## Resolved context
- Cache dir (fallback compute): !`echo "${CLAUDE_PLUGIN_DATA:-UNSET}/cache-$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"`
- Shared workflow + component reference:
!`cat "${CLAUDE_PLUGIN_ROOT}/references/cck-workflow.md" "${CLAUDE_PLUGIN_ROOT}/references/components/rule.md" 2>/dev/null`

## Procedure
Run the requested mode from `$ARGUMENTS` (`create` | `validate <path>` |
`adjust <path>`) following the shared workflow above. Prefer the `CACHE_DIR`
announced in the SessionStart context; otherwise use the fallback above.
Dispatch the `cc-knowledge` agent (Agent tool, subagent_type
`claude-code-knowledge:cc-knowledge`) for the CURRENT rules of a path-scoped
rule, passing it `CACHE_DIR`. Never rely on training memory for frontmatter keys.
