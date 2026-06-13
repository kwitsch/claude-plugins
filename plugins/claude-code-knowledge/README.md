# claude-code-knowledge

Corrects stale model knowledge about authoring Claude Code components by
grounding every answer in the *current* official docs (`code.claude.com/docs`).
A SessionStart hook maintains a version-scoped local doc cache, and a PreToolUse
hook reroutes any `claude-code-guide` subagent dispatch to the live-docs-grounded
`cc-knowledge` agent.

## Install

```
/plugin install claude-code-knowledge@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `cck-skill` | Create, validate, or adjust a Skill (`SKILL.md`) against the current docs. |
| `cck-agent` | Create, validate, or adjust a subagent (`agents/<name>.md`) against the current docs. |
| `cck-rule` | Create, validate, or adjust a path-scoped rule (`.claude/rules/*.md`) against the current docs. |
| `cck-hook` | Create, validate, or adjust a hook (`hooks.json` / `plugin.json` hooks) against the current docs. |

Each skill runs `create | validate <path> | adjust <path>` and routes through the
`cc-knowledge` agent, so frontmatter keys, schemas, and structure match the
running Claude Code version rather than stale training memory.

## Agents

| Agent | Model | Role |
|---|---|---|
| `cc-knowledge` | haiku | Answers Claude Code authoring questions only from a version-scoped local cache of the live docs (fetching on miss) and cites the doc it used. Complements the built-in `claude-code-guide`. |

## Requirements

- The `claude` CLI on PATH (used to detect the running version).
- `curl` (the agent's primary doc fetch path) and network access to
  `code.claude.com`. Without them the agent degrades to a WebFetch fallback and
  reports that caching is unavailable.

## Notes

- Cache location: `~/.claude/plugins/data/claude-code-knowledge/cache-<version>/`
  (the SessionStart hook announces the exact runtime path).
- The version-scoped layout means upgrading Claude Code transparently refreshes
  the cached docs (old caches are purged on the next session start).
