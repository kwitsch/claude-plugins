# claude-code-knowledge

Lookup skill plus harness-optimized reference files for authoring and configuring Claude Code — skills, subagents, hooks, slash commands, MCP, plugins, CLAUDE.md memory, and settings — with a read-only expert agent that replaces the built-in claude-code-guide. Retrieves only the relevant section into context.

## Install

```
/plugin install claude-code-knowledge@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `cc-reference` | Looks up the relevant section from the bundled reference files and loads only that section into context, keeping token cost low. |

## Agents

| Agent | Model | Role |
|---|---|---|
| `claude-code-expert` | haiku | Answers Claude Code authoring questions (skills, subagents, hooks) strictly via the `cc-reference` skill — read-only, never from training memory. A `PreToolUse` hook transparently reroutes the built-in `claude-code-guide` agent to it, so existing "ask the guide" flows get the curated answer. |

## Reference files

| File | Covers |
|---|---|
| `claude-code-skills-reference.md` | Authoring Claude Code skills: frontmatter fields, trigger patterns, tool access, inline script conventions. |
| `claude-code-agents-reference.md` | Authoring Claude Code subagents: manifest fields, tool lists, delegation patterns, model selection. |
| `claude-code-hooks-reference.md` | Hook mechanics: event types, hook schemas, lifecycle, exit codes, input/output shapes. |
| `hook-handler-selection.md` | Choosing the right hook-handler type: decision table mapping event + behavior to command hook vs. mcp_tool hook. |
| `claude-code-commands-reference.md` | Authoring custom slash commands: locations & precedence, frontmatter, arguments, dynamic context, namespacing; built-in commands. |
| `claude-code-mcp-reference.md` | MCP integration: `.mcp.json`, transports, config scopes, auth, tool naming, managed restrictions. |
| `claude-code-plugins-reference.md` | Plugin authoring: `plugin.json`/`marketplace.json` schema, layout, path variables, components, dependencies, CLI. |
| `claude-code-memory-reference.md` | `CLAUDE.md` memory: locations & precedence, imports, auto-memory, what belongs. |
| `claude-code-settings-reference.md` | Config surface: `settings.json` & scope precedence, env vars, permissions & modes, model config, output styles, statusline, sandboxing. |

## Usage

Once installed, invoke the skill with your question:

```
/claude-code-knowledge:cc-reference <your question>
```

The skill matches your question against the section index in `SKILL.md` and loads only the matched reference section, keeping context small. The bundled reference files are the primary source (no network needed). When they don't cover a question, the skill falls back to `WebFetch` against the current official Anthropic docs and flags that the answer came from live docs rather than the bundled reference — a hint to run `/update-cc-references`.

You can also let the expert agent drive: any dispatch of the built-in `claude-code-guide` subagent is rerouted by a `PreToolUse` hook to `claude-code-knowledge:claude-code-expert`, which answers only from the cc-reference knowledge and has no write access.

## Maintenance

Reference files are kept current by the repo-only skill `/update-cc-references [skills|agents|hooks|all]` (not shipped with the plugin). It re-fetches the official Anthropic docs, and on any change minor-bumps the version in `plugin.json` and opens a PR. CI tags the version after merge.
