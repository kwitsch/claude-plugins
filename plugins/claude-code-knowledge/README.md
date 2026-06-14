# claude-code-knowledge

Lookup skill plus harness-optimized reference files for authoring Claude Code skills, subagents, and hooks. Retrieves only the relevant section into context.

## Install

```
/plugin install claude-code-knowledge@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `cc-reference` | Looks up the relevant section from the bundled reference files and loads only that section into context, keeping token cost low. |

## Reference files

| File | Covers |
|---|---|
| `claude-code-skills-reference.md` | Authoring Claude Code skills: frontmatter fields, trigger patterns, tool access, inline script conventions. |
| `claude-code-agents-reference.md` | Authoring Claude Code subagents: manifest fields, tool lists, delegation patterns, model selection. |
| `claude-code-hooks-reference.md` | Hook mechanics: event types, hook schemas, lifecycle, exit codes, input/output shapes. |
| `hook-handler-selection.md` | Choosing the right hook-handler type: decision table mapping event + behavior to command hook vs. mcp_tool hook. |

## Usage

Once installed, invoke the skill with your question:

```
/claude-code-knowledge:cc-reference <your question>
```

The skill matches your question against the section index in `SKILL.md` and loads only the matched reference section, keeping context small. The bundled reference files are the primary source (no network needed). When they don't cover a question, the skill falls back to `WebFetch` against the current official Anthropic docs and flags that the answer came from live docs rather than the bundled reference — a hint to run `/update-cc-references`.

## Maintenance

Reference files are kept current by the repo-only skill `/update-cc-references [skills|agents|hooks|all]` (not shipped with the plugin). It re-fetches the official Anthropic docs, and on any change minor-bumps the version in `plugin.json` and opens a PR. CI tags the version after merge.
