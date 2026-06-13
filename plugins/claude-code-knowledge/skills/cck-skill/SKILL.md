---
name: cck-skill
description: Create, validate, or adjust a Claude Code Skill (SKILL.md) using current official docs. Usage: /cck-skill create | validate <path> | adjust <path>. Routes through the cc-knowledge agent so frontmatter keys and structure match the running Claude Code version, not stale training memory.
argument-hint: "create | validate <path> | adjust <path>"
---

# /cck-skill

Component type: **skill** (`SKILL.md`).

## Resolved context
- Cache dir (fallback compute): !`echo "${CLAUDE_PLUGIN_DATA:-UNSET}/cache-$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"`
- Shared workflow + component reference:
!`cat "${CLAUDE_PLUGIN_ROOT}/references/cck-workflow.md" "${CLAUDE_PLUGIN_ROOT}/references/components/skill.md" 2>/dev/null`

## Procedure
Run the requested mode from `$ARGUMENTS` (`create` | `validate <path>` |
`adjust <path>`) following the shared workflow above. Prefer the `CACHE_DIR`
announced in the SessionStart context; otherwise use the fallback above.
Dispatch the `cc-knowledge` agent (Agent tool, subagent_type
`claude-code-knowledge:cc-knowledge`) for the CURRENT rules of a skill, passing
it `CACHE_DIR`. Never rely on training memory for frontmatter keys.
