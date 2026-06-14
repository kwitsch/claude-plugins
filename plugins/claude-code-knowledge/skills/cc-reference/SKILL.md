---
name: cc-reference
description: Answers questions about authoring Claude Code Skills, subagents, and hooks (frontmatter fields, lifecycle, permissions, invocation, dynamic context injection, forks, memory, hook events/matchers/exit-codes/decision-control, hook handler-type choice) by retrieving only the relevant section from the bundled reference files. Use when the user asks how a Claude Code skill, subagent, or hook feature works, or invokes /cc-reference with a question.
argument-hint: [your question]
allowed-tools: Read, Grep
---

# Claude Code reference lookup

Answer `$ARGUMENTS` from the bundled reference files. Retrieve only the matching section(s) — do NOT read whole files into context.

Files live next to this skill:
- `${CLAUDE_SKILL_DIR}/claude-code-skills-reference.md` — authoring **Skills**
- `${CLAUDE_SKILL_DIR}/claude-code-agents-reference.md` — authoring **subagents / agents**
- `${CLAUDE_SKILL_DIR}/claude-code-hooks-reference.md` — **hooks** mechanics (events, matchers, I/O, exit codes, decision control)
- `${CLAUDE_SKILL_DIR}/hook-handler-selection.md` — choosing a hook **handler `type`** (command/.sh/.mjs/binary vs http/mcp_tool/prompt/agent)

## Retrieval procedure

1. Pick the file from the question using the routing map below. If the topic appears in both (forks, preload-skills, `context: fork`), check both. Hook questions usually need **both** hooks files: `claude-code-hooks-reference.md` for mechanics, `hook-handler-selection.md` for "which `type` should I use".
2. From the section index, pick the matching `## heading`. `Grep -n` that heading text in the file to get its line number.
3. `Read` that file starting at the heading line with a small limit (~30–70 lines) to capture just that section. Extend the range minimally only if the section is cut off.
4. Answer concisely in the user's language, naming the section you used. Keep field names, frontmatter keys, env vars, and tool names exact. Give the key directives, not a verbatim dump.
5. If nothing matches the index, `Grep -ni` the question's keywords across the reference files, then read the best-matching span.

Never `cat`/read an entire reference file. Load only matched sections so the main context stays small.

## Routing map (topic → file)

Map key → file on disk: `skills-reference` → `claude-code-skills-reference.md`;
`agents-reference` → `claude-code-agents-reference.md`; `hooks-reference` →
`claude-code-hooks-reference.md`; `hook-handler-selection` →
`hook-handler-selection.md`. Hook questions usually need **both** hooks files
(`claude-code-hooks-reference.md` for mechanics, `hook-handler-selection.md` for
which handler `type`).

**skills-reference** (`claude-code-skills-reference.md`) — skill discovery & progressive disclosure, SKILL.md frontmatter, command-name mapping, conciseness / degrees of freedom, descriptions & naming, progressive-disclosure patterns, workflows & feedback loops, executable-code/script best practices, MCP tool references, invocation control (`disable-model-invocation`, `user-invocable`), skill content lifecycle & compaction budget, dynamic context injection (`` !`cmd` `` / substitutions / `${CLAUDE_SKILL_DIR}`), `context: fork`, skill scopes & precedence, skill permissions (`allowed-tools`, `Skill(...)`, `skillOverrides`), evals, anti-patterns, pre-ship checklist.

**agents-reference** (`claude-code-agents-reference.md`) — subagent vs main vs skill vs fork decision, built-in agents (Explore/Plan/general-purpose), agent scopes & precedence, subagent frontmatter, model resolution order, tool/capability control (`tools`/`disallowedTools`/`Agent(...)`), MCP scoping, permission modes, conditional `PreToolUse` rules, preload skills (`skills:` field), persistent memory, hooks (`SubagentStart`/`SubagentStop`), delegation & `--agent`, foreground/background, parallel/chain patterns, nested subagents, forks, startup context, resume/transcripts, plugin restrictions, disabling subagents.

**hooks-reference** (`claude-code-hooks-reference.md`) — hook events catalog & cadence, hook locations/scope, matcher semantics (3 modes, per-event field, MCP tool matching), `if` field, handler field tables (common/command/http/mcp_tool/prompt/agent), exec vs shell form + path placeholders, input schema (common + tool_input), exit codes + exit-2-per-event, HTTP response handling, JSON output (universal/`decision`/`hookSpecificOutput`), `additionalContext`, `terminalSequence`, decision-control-by-event, content rewriting, SessionStart env/`reloadSkills`, hooks in skills/agents, `/hooks` menu, `disableAllHooks`, security constraints.

**hook-handler-selection** (`hook-handler-selection.md`) — choosing the handler `type`: decision rules top→bottom, fail-open vs fail-closed (security gating), type comparison table (process/latency/hard-block/state/timeout), `mcp_tool` shape, command exec/shell form on Windows, hard constraints, quick map (hot-path/stateful/semantic/off-host).

## Section index

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
