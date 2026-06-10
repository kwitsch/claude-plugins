---
paths:
  - "plugins/*/agents/*.md"
---

# Rule: agent .md authoring reference

Source: https://code.claude.com/docs/en/sub-agents

## File structure

```markdown
---
name: my-agent          # required
description: ...        # required
# optional fields below
---

System prompt body goes here.
Claude receives ONLY this body (+ basic env: cwd).
NOT the full Claude Code system prompt. No conversation history.
```

## Frontmatter (complete reference)

| Field | Required | Notes |
|---|---|---|
| `name` | **Yes** | Lowercase letters + hyphens. Hooks receive as `agent_type`. Filename does NOT have to match. |
| `description` | **Yes** | When Claude should delegate to this agent. Write precisely — Claude auto-delegates based on this. |
| `tools` | No | Allowlist of tools. Omit = inherits all parent tools. Use `skills` to preload skills, not `Skill` here. |
| `disallowedTools` | No | Removed from inherited or specified tool list. |
| `model` | No | `sonnet` `opus` `haiku` `fable` · full model ID · `inherit` (default). |
| `permissionMode` | No | **Plugin subagents: IGNORED.** `default` `acceptEdits` `auto` `dontAsk` `bypassPermissions` `plan` |
| `maxTurns` | No | Max agentic turns before subagent stops. |
| `skills` | No | Skills to preload into context at startup (full content, not just description). Skills with `disable-model-invocation: true` are NOT preloaded. |
| `initialPrompt` | No | Initial prompt passed to subagent on first turn. |
| `memory` | No | Persistent cross-session memory scope: `user` `project` `local`. |
| `background` | No | `true` = always run as background task. Default: `false`. |
| `effort` | No | `low` `medium` `high` `xhigh` `max` — overrides session effort level. |
| `isolation` | No | `worktree` = isolated git worktree (branched from default branch). |
| `color` | No | Color shown in agent view UI. |
| `mcpServers` | No | **Plugin subagents: IGNORED.** |
| `hooks` | No | **Plugin subagents: IGNORED.** (Stop hooks auto-converted to SubagentStop.) |

## Plugin subagent restrictions ⚠️

`hooks`, `mcpServers`, and `permissionMode` are **silently ignored** when loaded from a plugin's `agents/` directory. If these are needed, copy the agent file to `.claude/agents/` instead.

## What the agent receives at startup

- ✓ The agent body as system prompt
- ✓ Basic environment: working directory
- ✓ Custom CLAUDE.md files (unlike built-in Explore/Plan)
- ✗ Parent conversation history
- ✗ Full Claude Code system prompt

`cd` commands do NOT persist between Bash tool calls and do NOT affect the main session's cwd.

## Best practices

- **One task**: each agent should excel at exactly one specific task.
- **Precise description**: Claude auto-delegates based on description match. Include "Use proactively after X" to encourage delegation. Vague descriptions → missed or wrong delegation.
- **Least privilege tools**: grant only the tools the agent actually needs. Read-only agents → omit `Write`/`Edit`. Reduces blast radius.
- **No nested subagents**: subagents cannot spawn other subagents. Use Skills or chain subagents from the main conversation instead.
- **`skills` not `Skill` in tools**: to inject skill content into the agent, use the `skills` frontmatter field. Listing `Skill` in `tools` does not preload content.
- **`isolation: worktree`**: use only when the agent makes file edits that would conflict with parallel agents or the main checkout. Adds setup cost (~200–500 ms + disk).
- **`context: fork` alternative**: for a one-off isolated run that should inherit the current conversation context, use a skill with `context: fork` instead of a named agent.
