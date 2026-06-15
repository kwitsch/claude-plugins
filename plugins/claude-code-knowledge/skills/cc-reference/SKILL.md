---
name: cc-reference
description: Answers questions about authoring and configuring Claude Code — Skills, subagents, hooks, slash commands, MCP servers, plugins, CLAUDE.md memory, and settings/permissions (frontmatter fields, lifecycle, invocation, dynamic context, forks, hook events/matchers/exit-codes, handler-type choice, .mcp.json/transports, plugin.json/marketplace, settings.json/env vars/permission modes) by retrieving only the relevant section from the bundled reference files, falling back to the live official docs via WebFetch when the bundled files don't cover the question. Use when the user asks how a Claude Code authoring or configuration feature works, or invokes /cc-reference with a question.
argument-hint: [your question]
allowed-tools: Read, Grep, WebFetch, WebSearch
---

# Claude Code reference lookup

Answer `$ARGUMENTS` from the bundled reference files. Retrieve only the matching section(s) — do NOT read whole files into context.

Files live in the `references/` subfolder of this skill:
- `${CLAUDE_SKILL_DIR}/references/claude-code-skills-reference.md` — authoring **Skills**
- `${CLAUDE_SKILL_DIR}/references/claude-code-agents-reference.md` — authoring **subagents / agents**
- `${CLAUDE_SKILL_DIR}/references/claude-code-hooks-reference.md` — **hooks** mechanics (events, matchers, I/O, exit codes, decision control)
- `${CLAUDE_SKILL_DIR}/references/hook-handler-selection.md` — choosing a hook **handler `type`** (command/.sh/.mjs/binary vs http/mcp_tool/prompt/agent)
- `${CLAUDE_SKILL_DIR}/references/claude-code-commands-reference.md` — authoring **slash commands** (`.claude/commands`, frontmatter, `$ARGUMENTS`, dynamic context, namespacing)
- `${CLAUDE_SKILL_DIR}/references/claude-code-mcp-reference.md` — **MCP** integration (`.mcp.json`, transports, scopes, auth, tool naming, managed restrictions)
- `${CLAUDE_SKILL_DIR}/references/claude-code-plugins-reference.md` — **plugins** (`plugin.json`/`marketplace.json`, layout, path variables, components, CLI)
- `${CLAUDE_SKILL_DIR}/references/claude-code-memory-reference.md` — **memory** (`CLAUDE.md` locations/precedence, `@imports`, auto-memory)
- `${CLAUDE_SKILL_DIR}/references/claude-code-settings-reference.md` — **settings/config** (`settings.json`, env vars, permissions & modes, model config, output styles, statusline, sandboxing)
- `${CLAUDE_SKILL_DIR}/references/skill-folder-structure.md` — **skill folder layout** (skill dir structure + the `references/` subfolder convention; static, not doc-refreshed)

## Retrieval procedure

1. Pick the file from the question using the routing map below. If the topic appears in both (forks, preload-skills, `context: fork`), check both. Hook questions usually need **both** hooks files: `claude-code-hooks-reference.md` for mechanics, `hook-handler-selection.md` for "which `type` should I use".
2. From the section index, pick the matching entry — it is an abbreviated navigation label, not a verbatim heading. `Grep -n` a distinctive substring of it (the leading words) to find the actual `## ` heading and its line number; real headings may carry version-gate or qualifier suffixes the index omits.
3. `Read` that file starting at the heading line with a small limit (~30–70 lines) to capture just that section. Extend the range minimally only if the section is cut off.
4. Answer concisely in the user's language, naming the section you used. Keep field names, frontmatter keys, env vars, and tool names exact. Give the key directives, not a verbatim dump.
5. If nothing matches the index, `Grep -ni` the question's keywords across the reference files, then read the best-matching span.
6. **Live-doc fallback.** If the bundled files still don't answer the question — the topic is absent, or the matched section is silent on what was asked — `WebFetch` the current official doc for that topic from the *Live-doc sources* map below (prefer the `.md` variant; `WebSearch` for the canonical page if a URL 404s). Answer from the fetched page and **state explicitly that the answer came from the live docs, not the bundled reference** (the bundled file may simply be stale — flag it so the user can run `/update-cc-references`). Do not fall back to training memory.

Never `cat`/read an entire reference file. Load only matched sections so the main context stays small. Prefer the bundled files first; the WebFetch fallback is only for gaps they don't cover.

## Live-doc sources (fallback only)

Fetch these only when the bundled files don't answer (step 6). Same canonical
docs the `update-cc-references` maintenance skill refreshes from:

- **skills** → `https://code.claude.com/docs/en/skills` (+ best practices: `https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices`)
- **subagents / agents** → `https://code.claude.com/docs/en/sub-agents`
- **hooks** (mechanics + handler selection) → `https://code.claude.com/docs/en/hooks` (+ examples: `https://code.claude.com/docs/en/hooks-guide`)
- **slash commands** → `https://code.claude.com/docs/en/slash-commands` (+ built-ins: `https://code.claude.com/docs/en/commands`)
- **MCP** → `https://code.claude.com/docs/en/mcp` (+ `https://code.claude.com/docs/en/mcp-quickstart`, `https://code.claude.com/docs/en/managed-mcp`)
- **plugins** → `https://code.claude.com/docs/en/plugins` (+ `https://code.claude.com/docs/en/plugins-reference`, `https://code.claude.com/docs/en/plugin-marketplaces`)
- **memory** → `https://code.claude.com/docs/en/memory`
- **settings/config** → `https://code.claude.com/docs/en/settings` (+ `env-vars`, `permissions`, `permission-modes`, `model-config`, `output-styles`, `statusline`, `sandboxing` under `https://code.claude.com/docs/en/`)

## Routing map (topic → file)

Map key → file on disk: `skills-reference` → `claude-code-skills-reference.md`;
`agents-reference` → `claude-code-agents-reference.md`; `hooks-reference` →
`claude-code-hooks-reference.md`; `hook-handler-selection` →
`hook-handler-selection.md`; `commands-reference` →
`claude-code-commands-reference.md`; `mcp-reference` → `claude-code-mcp-reference.md`;
`plugins-reference` → `claude-code-plugins-reference.md`; `memory-reference` →
`claude-code-memory-reference.md`; `settings-reference` →
`claude-code-settings-reference.md`; `skill-folder-structure` →
`skill-folder-structure.md`. Hook questions usually need **both** hooks files
(`claude-code-hooks-reference.md` for mechanics, `hook-handler-selection.md` for
which handler `type`).

**skills-reference** (`claude-code-skills-reference.md`) — skill discovery & progressive disclosure, SKILL.md frontmatter, command-name mapping, conciseness / degrees of freedom, descriptions & naming, progressive-disclosure patterns, workflows & feedback loops, executable-code/script best practices, MCP tool references, invocation control (`disable-model-invocation`, `user-invocable`), skill content lifecycle & compaction budget, dynamic context injection (`!cmd` / substitutions / `${CLAUDE_SKILL_DIR}`), `context: fork`, skill scopes & precedence, skill permissions (`allowed-tools`, `Skill(...)`, `skillOverrides`), evals, anti-patterns, pre-ship checklist.

**agents-reference** (`claude-code-agents-reference.md`) — subagent vs main vs skill vs fork decision, built-in agents (Explore/Plan/general-purpose), agent scopes & precedence, subagent frontmatter, model resolution order, tool/capability control (`tools`/`disallowedTools`/`Agent(...)`), MCP scoping, permission modes, conditional `PreToolUse` rules, preload skills (`skills:` field), persistent memory, hooks (`SubagentStart`/`SubagentStop`), delegation & `--agent`, foreground/background, parallel/chain patterns, nested subagents, forks, startup context, resume/transcripts, plugin restrictions, disabling subagents.

**hooks-reference** (`claude-code-hooks-reference.md`) — hook events catalog & cadence, hook locations/scope, matcher semantics (3 modes, per-event field, MCP tool matching), `if` field, handler field tables (common/command/http/mcp_tool/prompt/agent), exec vs shell form + path placeholders, input schema (common + tool_input), exit codes + exit-2-per-event, HTTP response handling, JSON output (universal/`decision`/`hookSpecificOutput`), `additionalContext`, `terminalSequence`, decision-control-by-event, content rewriting, SessionStart env/`reloadSkills`, hooks in skills/agents, `/hooks` menu, `disableAllHooks`, security constraints.

**hook-handler-selection** (`hook-handler-selection.md`) — choosing the handler `type`: decision rules top→bottom, fail-open vs fail-closed (security gating), type comparison table (process/latency/hard-block/state/timeout), `mcp_tool` shape, command exec/shell form on Windows, hard constraints, quick map (hot-path/stateful/semantic/off-host).

**commands-reference** (`claude-code-commands-reference.md`) — custom slash commands: command vs skill, locations & precedence (`.claude/commands`, `~/.claude/commands`, plugin commands), frontmatter, `$ARGUMENTS`/`$1..$N`/named args, dynamic context (`!bash`, `@file`), namespacing & invocation, built-in commands.

**mcp-reference** (`claude-code-mcp-reference.md`) — MCP integration: `.mcp.json`, config scopes & precedence, transports (stdio/http/sse/ws), server config schema, authentication, `claude mcp`/`/mcp`, tool naming & permissions (`mcp__server__tool`), managed/enterprise restrictions.

**plugins-reference** (`claude-code-plugins-reference.md`) — plugin authoring: structure/layout, `plugin.json` schema, `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`, component auto-discovery, `marketplace.json`, dependencies, hints, plugin CLI.

**memory-reference** (`claude-code-memory-reference.md`) — `CLAUDE.md` memory: locations & precedence, `@imports`, auto-memory, what belongs, quick-add / `/memory`.

**settings-reference** (`claude-code-settings-reference.md`) — config surface: `settings.json` & scope precedence, settings keys, env vars, permissions & permission modes, model config, output styles, statusline, sandboxed Bash.

**skill-folder-structure** (`skill-folder-structure.md`) — skill directory layout: `SKILL.md` + supporting files, `scripts/`, and the convention that ≥2 bundled reference files live in a `references/` subfolder (1 file → next to `SKILL.md`). Static layout reference, not doc-refreshed.

## Section index

Entries are abbreviated navigation labels, not verbatim `## ` headings — real headings may include version-gate or qualifier suffixes. Match by distinctive substring (see retrieval step 2).

### claude-code-skills-reference.md
```
What a skill is / when to choose it
Discovery & progressive disclosure (mechanics)
Frontmatter reference (Claude Code)        # incl. Command-name mapping
Core authoring principles                  # Concise; Degrees of freedom; Test across models; Descriptions; Naming
Progressive disclosure patterns
Workflows & feedback loops
Content guidelines
Common patterns
Skills with executable code
MCP tool references
Invocation control matrix
Skill content lifecycle
Dynamic context injection (CLI feature)    # incl. Substitutions
context: fork (run in a subagent)
Where skills live / precedence
Permissions / access control
Evaluation & iterative development
Anti-patterns
Pre-ship checklist
Version / surface notes
```

### claude-code-agents-reference.md
```
What a subagent is / when to choose it     # incl. Decision matrix
Built-in subagents
Scope & precedence
Frontmatter reference
Model resolution order
Tool & capability control
MCP scoping
Permission modes
Conditional rules (finer than `tools`)
Preload skills into a subagent
Persistent memory
Hooks
Delegation & explicit invocation
Foreground vs background
Common patterns
Nested subagents
Forks
What loads at a subagent's startup
Resume subagents
Plugin subagent restrictions
Best practices
Disable specific subagents
Version notes
```

### claude-code-hooks-reference.md
```
Model: three nesting levels
Hook locations / scope
Event catalog (cadence + when)
Matcher semantics                          # incl. if field, MCP tool matching
Handler types (field tables)               # incl. Exec vs shell form
Input (stdin for command; POST body for http)
Exit codes                                 # incl. exit 2 effect per event
HTTP response handling
JSON output                                # universal; decision control by event; content rewriting
SessionStart specifics
Hooks in skills/agents
/hooks menu & disabling
Hard constraints / security
Version gates
```

### hook-handler-selection.md
```
Handler types
Decision rules — evaluate top→bottom, first match wins
Type comparison
mcp_tool handler shape
command form (.sh / .mjs / binary)
Hard constraints
Quick map
```

### claude-code-commands-reference.md
```
What a slash command is / when vs a skill
Locations & precedence
Frontmatter reference
Arguments                                  # $ARGUMENTS, $1..$N, named args
Dynamic context                            # !bash injection, @file references
Environment
Namespacing & invocation
Built-in commands
Version notes
```

### claude-code-mcp-reference.md
```
What MCP is / when to use
Config locations & scopes
Transports
Server config schema
Authentication
Adding & managing servers
Tool naming & permissions
Managed MCP / enterprise
Version notes
```

### claude-code-plugins-reference.md
```
What a plugin is / components
Plugin structure & layout
plugin.json schema
Path variables
Component auto-discovery
Marketplace
Plugin dependencies
Plugin hints
Plugin CLI
Version notes
```

### claude-code-memory-reference.md
```
CLAUDE.md: what & when
Locations & precedence
Imports                                    # @path syntax, recursion depth, home-dir imports
Auto memory
What belongs / what doesn't
Quick add & editing
Version notes
```

### claude-code-settings-reference.md
```
settings.json: locations & scope precedence
Settings keys
Environment variables
Permissions
Permission modes
Model configuration
Output styles
Statusline
Sandboxed Bash tool
Version notes
```

### skill-folder-structure.md
```
Skill directory layout
Convention: one supporting file vs many → references/
Example (this skill)
```
