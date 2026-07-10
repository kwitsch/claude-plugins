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
| `cc-review` | Audits a Claude Code component (plugin/skill/agent/hook/command/MCP/memory/settings) against the `cc-reference` rules via the read-only `cc-reviewer` agent, then interactively applies the recommendations you select. |
| `cc-author` | Creates a new Claude Code component (skill/agent/hook/command/MCP/plugin/CLAUDE.md/settings) grounded strictly in the `cc-reference` rules via the read-only `cc-author-planner` agent, writes it, and optionally hands it to `cc-review`. |
| `cc-memory` | Discovers every CLAUDE.md and `.claude/rules/*.md` file in the project (default: whole repo), audits each against the `cc-reference` memory rules (reusing the `cc-reviewer` agent), grades them in a claude-md-improver-style quality report, recommends leanness/scope-splits (subfolder `CLAUDE.md` or `.claude/rules/` with `paths:`); then interactively applies the improvements you pick. |
| `cc-compress` | Compresses a markdown memory/instruction file (e.g. `CLAUDE.md`) into dense caveman-style prose in place, cutting the token cost of loading it every session. Backs up the original to session-temp storage for rollback. Adaptation of upstream `caveman-compress`. |

## Agents

| Agent | Model | Role |
|---|---|---|
| `claude-code-expert` | haiku | Answers Claude Code authoring questions (skills, subagents, hooks) strictly via the `cc-reference` skill — read-only, never from training memory. A `PreToolUse` hook transparently reroutes the built-in `claude-code-guide` agent to it, so existing "ask the guide" flows get the curated answer. |
| `cc-reviewer` | haiku | Read-only worker dispatched by the `cc-review` skill. Audits one component type in a target against the `cc-reference` rules and returns structured JSON findings — never writes. |
| `cc-author-planner` | haiku | Read-only worker dispatched by the `cc-author` skill. Composes the new component's file content strictly from the `cc-reference` knowledge and returns it as JSON — never writes. |

## Reference files

All reference files live in the skill's `references/` subfolder
(`skills/cc-reference/references/`).

| File | Covers |
|---|---|
| `claude-code-skills-reference.md` | Authoring Claude Code skills: frontmatter fields, trigger patterns, tool access, inline script conventions. |
| `claude-code-agents-reference.md` | Authoring Claude Code subagents: manifest fields, tool lists, delegation patterns, model selection. |
| `claude-code-hooks-reference.md` | Hook mechanics: event types, hook schemas, lifecycle, exit codes, input/output shapes. |
| `hook-handler-selection.md` | Choosing the right hook-handler type: decision table mapping event + behavior to command hook vs. mcp_tool hook. |
| `claude-code-mcp-tool-hooks-reference.md` | Backing a hook with an MCP-server tool (`mcp_tool`): fields, the `plugin:<plugin>:<key>` server-name namespacing gotcha, tool-text→decision output contract, fail-open, plugin server pattern. |
| `claude-code-commands-reference.md` | Authoring custom slash commands: locations & precedence, frontmatter, arguments, dynamic context, namespacing; built-in commands. |
| `claude-code-mcp-reference.md` | MCP integration: `.mcp.json`, transports, config scopes, auth, tool naming. |
| `claude-code-mcp-managed-reference.md` | Managed/enterprise MCP: `managed-mcp.json` exclusive control, `allowedMcpServers`/`deniedMcpServers` allowlists & denylists, evaluation order. |
| `claude-code-plugins-reference.md` | Plugin authoring: `plugin.json`/`marketplace.json` schema, layout, path variables, components, dependencies, CLI. |
| `claude-code-memory-reference.md` | `CLAUDE.md` memory: locations & precedence, imports, auto-memory, what belongs. |
| `claude-code-settings-reference.md` | Config surface: `settings.json` & scope precedence, env vars, permissions & modes, model config, output styles, statusline, sandboxing. |
| `skill-folder-structure.md` | Claude Code skill directory layout + the convention that ≥2 bundled reference files live in a `references/` subfolder. Static — not refreshed by `/update-cc-references`. |

## Usage

Once installed, invoke the skill with your question:

```
/claude-code-knowledge:cc-reference <your question>
```

The skill matches your question against the section index in `SKILL.md` and loads only the matched reference section, keeping context small. The bundled reference files are the primary source (no network needed). When they don't cover a question, the skill falls back to `WebFetch` against the current official Anthropic docs and flags that the answer came from live docs rather than the bundled reference — a hint to run `/update-cc-references`.

You can also let the expert agent drive: any dispatch of the built-in `claude-code-guide` subagent is rerouted by a `PreToolUse` hook to `claude-code-knowledge:claude-code-expert`, which answers only from the cc-reference knowledge and has no write access.

## Maintenance

Reference files are kept current by the repo-only skill `/update-cc-references [skills|agents|hooks|all]` (not shipped with the plugin). It re-fetches the official Anthropic docs, and on any change minor-bumps the version in `plugin.json` and opens a PR. CI tags the version after merge.
