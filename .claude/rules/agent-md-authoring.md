---
paths:
  - "plugins/*/agents/*.md"
---

# Rule: agent .md authoring reference

Source: <https://code.claude.com/docs/en/sub-agents>

## File structure

```markdown
---
name: my-agent # required
description: ... # required
# optional fields below
---

System prompt body goes here.
Claude receives ONLY this body (+ basic env: cwd).
NOT the full Claude Code system prompt. No conversation history.
```

## Frontmatter (complete reference)

| Field             | Required | Notes                                                                                                                                                                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | **Yes**  | Lowercase letters + hyphens. Hooks receive as `agent_type`. Filename does NOT have to match.                                                                                                                                      |
| `description`     | **Yes**  | When Claude should delegate to this agent. Write precisely — Claude auto-delegates based on this.                                                                                                                                 |
| `tools`           | No       | Allowlist of tools. Omit = inherits all parent tools. Use `skills` to preload skills, not `Skill` here.                                                                                                                           |
| `disallowedTools` | No       | Removed from inherited or specified tool list.                                                                                                                                                                                    |
| `model`           | No       | `sonnet` `opus` `haiku` `fable` · full model ID · `inherit` (default).                                                                                                                                                            |
| `permissionMode`  | No       | **Plugin subagents: IGNORED.** `default` `acceptEdits` `auto` `dontAsk` `bypassPermissions` `plan`, or (v2.1.200+) `manual` as an alias for `default`.                                                                            |
| `maxTurns`        | No       | Max agentic turns before subagent stops.                                                                                                                                                                                          |
| `skills`          | No       | Skills to preload into context at startup (full content, not just description). Skills with `disable-model-invocation: true` are NOT preloaded.                                                                                   |
| `initialPrompt`   | No       | Auto-submitted first user turn only when the agent runs as the **main session agent** (`--agent`/`agent` setting). **Ignored when invoked as a subagent** — has no effect in a plugin `agents/*.md` file used only as a subagent. |
| `memory`          | No       | Persistent cross-session memory scope: `user` `project` `local`.                                                                                                                                                                  |
| `background`      | No       | `true` = always run as background task. Omitted → Claude decides (v2.1.198+: background by default, foreground only when the result is needed immediately).                                                                       |
| `effort`          | No       | `low` `medium` `high` `xhigh` `max` — overrides session effort level.                                                                                                                                                             |
| `isolation`       | No       | `worktree` = isolated git worktree (branched from default branch).                                                                                                                                                                |
| `color`           | No       | Color shown in agent view UI.                                                                                                                                                                                                     |
| `mcpServers`      | No       | **Plugin subagents: IGNORED.**                                                                                                                                                                                                    |
| `hooks`           | No       | **Plugin subagents: IGNORED.** (Stop hooks auto-converted to SubagentStop.)                                                                                                                                                       |
| `experimental`    | No       | Map of experimental options (subagent-file only, not read from `--agents` JSON). `cacheTtl` (v2.1.248+) sets the prompt-cache TTL (`5m`/`1h`) for this subagent's requests — nested inside `experimental`, not top-level.         |

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
- **Nested subagents** (v2.1.219+): a subagent can spawn its own subagents, by default down to 3 layers below the main conversation (a subagent at the depth limit receives no Agent tool and does the delegated work itself instead). Configurable via `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (set to `1` to disable nesting entirely). Prefer shallow chains — deep nesting compounds latency and context loss.
- **`skills` not `Skill` in tools**: to inject skill content into the agent, use the `skills` frontmatter field. Listing `Skill` in `tools` does not preload content.
- **`isolation: worktree`**: use only when the agent makes file edits that would conflict with parallel agents or the main checkout. Adds setup cost (~200–500 ms + disk).
- **`context: fork` alternative**: for a one-off isolated run that should inherit the current conversation context, use a skill with `context: fork` instead of a named agent.
