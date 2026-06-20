# Claude Code Subagents / Agents — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Claude Code "Create custom subagents"), verified 2026-06-21.
> Apply when authoring, reviewing, or refactoring a subagent definition (`.claude/agents/*.md`).

## What a subagent is / when to choose it

- Subagent = specialized agent in its own isolated context window, with own system prompt, tool access, permissions, optional model.
- Spawned by the main session via the **Agent** tool (renamed from `Task` in v2.1.63; `Task(...)` still aliases). Works within a single session.
- Returns only a summary → keeps verbose work (logs, search results, file reads) out of main context.
- "Agent" and "subagent" are the same thing; "subagent" = spawned by a main session for a scoped task.

### Decision: subagent vs main vs skill vs fork

- **Main conversation** when: frequent back-and-forth; phases share context (plan→implement→test); quick targeted change; latency matters (subagents start cold).
- **Subagent** when: verbose output you won't reference; need tool/permission restriction; self-contained → returns summary.
- **Skill** (inline) when: reusable prompt/workflow that should run in main context.
- **Fork** when: a side task needs the full current context (no re-explaining) — see Forks.
- **`/btw`** for a quick question about existing context (no tools, answer discarded).
- **Agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) for sustained parallelism / cross-session messaging beyond one context window.

## Built-in subagents

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| Explore | Haiku | read-only (no Write/Edit) | fast file discovery / code search. Specifies thoroughness: quick / medium / very thorough. |
| Plan | inherit | read-only | research during plan mode before presenting a plan |
| general-purpose | inherit | all | complex multi-step exploration + modification |
| statusline-setup | Sonnet | — | auto, on `/statusline` |
| claude-code-guide | Haiku | — | auto, on questions about Claude Code features |

- Explore + Plan **skip CLAUDE.md and git status** (kept small). All other built-in + custom agents load both.
- Block a built-in: `permissions.deny: ["Agent(Explore)"]`. Block all delegation: deny the `Agent` tool. Headless/SDK: `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`.

## Scope & precedence

| Location | Scope | Priority |
|---|---|---|
| Managed settings | org-wide | 1 (highest) |
| `--agents` CLI flag (JSON) | current session | 2 |
| `.claude/agents/` | project | 3 |
| `~/.claude/agents/` | all your projects | 4 |
| plugin `agents/` dir | where plugin enabled | 5 (lowest) |

- Identity comes only from the `name` field, not the path. Scanned recursively → organize in subfolders (`agents/review/`). Keep `name` unique across the tree (silent dedup on clash within a scope).
- Plugin subfolders DO scope the identifier: `agents/review/security.md` in `my-plugin` → `my-plugin:review:security`.
- Project agents discovered by walking up from cwd to repo root. version >= 2.1.178: when nested project `.claude/agents/` dirs define the same `name`, the definition closest to cwd wins.
- `--add-dir` dirs ARE scanned: a `.claude/agents/` inside an added dir loads alongside project agents. To share across projects without `--add-dir`, use `~/.claude/agents/` or a plugin.
- Edits on disk need a session restart; agents created via `/agents` apply immediately.

## Frontmatter reference

Required: `name`, `description`. Body = system prompt (subagent gets ONLY this + env details, not the full Claude Code system prompt).

| Field | Notes |
|---|---|
| `name` | lowercase + hyphens, unique. Hooks receive it as `agent_type`. Filename need not match. |
| `description` | when Claude should delegate here. Add "use proactively" to encourage delegation. |
| `tools` | allowlist; inherits all if omitted. Use `skills` field (not `Skill` here) to preload skills. Accepts MCP server-level patterns: `mcp__<server>` or `mcp__<server>__*` grants every tool from that server. |
| `disallowedTools` | denylist; removed from inherited/specified set. Accepts MCP patterns: `mcp__<server>` / `mcp__<server>__*` removes every tool from that server; `mcp__*` removes every MCP tool from any server. |
| `model` | `sonnet|opus|haiku|fable`, full ID (`claude-opus-4-8`), or `inherit`. Default `inherit`. |
| `permissionMode` | `default|acceptEdits|auto|dontAsk|bypassPermissions|plan`. Ignored for plugin agents. |
| `maxTurns` | max agentic turns before stop. |
| `skills` | preload FULL skill content at startup (not just description). |
| `mcpServers` | inline defs or name refs; scope MCP to this agent. Ignored for plugin agents. |
| `hooks` | lifecycle hooks scoped to this agent. Ignored for plugin agents. |
| `memory` | `user|project|local` → persistent cross-session memory dir. |
| `background` | `true` → always run as background task. Default false. |
| `effort` | `low|medium|high|xhigh|max`; overrides session. Model-dependent. |
| `isolation` | `worktree` → run in a temp git worktree (isolated repo copy; auto-cleaned if no changes; branches from default branch). |
| `color` | `red|blue|green|yellow|purple|orange|pink|cyan` for UI. |
| `initialPrompt` | auto-submitted first user turn when run as main session (`--agent`); commands/skills processed; prepended to user prompt. |

`--agents` JSON accepts the same fields; use `prompt` for the system prompt (= markdown body).

Minimal example:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---
You are a code reviewer. When invoked, analyze the code and give specific,
actionable feedback on quality, security, and best practices.
```

## Model resolution order

1. `CLAUDE_CODE_SUBAGENT_MODEL` env var → 2. per-invocation `model` param → 3. definition `model` frontmatter → 4. main conversation model.

## Tool & capability control

- **Restrict tools:** `tools:` (allowlist) OR `disallowedTools:` (denylist). If both: denylist applied first, then allowlist against the remainder; a tool in both is removed.
- **MCP server-level patterns** in either field: `mcp__<server>` / `mcp__<server>__*` = every tool from that server; in `disallowedTools`, `mcp__*` = every MCP tool from any server.
- **Never available to subagents** (UI/session-bound), even if listed: `AskUserQuestion`, `EnterPlanMode`, `ScheduleWakeup`, `WaitForMcpServers`, and `ExitPlanMode` (unless `permissionMode: plan`).
- **Restrict which agents a main-thread agent may spawn** (only under `claude --agent`): `tools: Agent(worker, researcher)` (allowlist). `Agent` w/o parens = any; omit `Agent` = none. In a *subagent* definition, the type-list inside parens is ignored (listing `Agent` just lets it spawn nested agents).

## MCP scoping

- `mcpServers:` entries = inline def (`stdio|http|sse|ws`, same schema as `.mcp.json`) connected for the agent's lifetime, OR a string name reusing the parent's connection.
- Define an MCP server inline here (not in `.mcp.json`) to keep its tool descriptions OUT of the main conversation's context.
- As of v2.1.153, managed-MCP restrictions, `--strict-mcp-config`, `--bare`, and allow/deny policies also cover subagent-frontmatter servers (blocked → skipped + warning). `--strict-mcp-config` does NOT filter servers passed via `--agents`/SDK `agents` (explicit caller input).

## Permission modes

| Mode | Behavior |
|---|---|
| `default` | standard prompts |
| `acceptEdits` | auto-accept edits + common fs commands in cwd/additionalDirectories |
| `auto` | background classifier reviews commands + protected-dir writes |
| `dontAsk` | auto-deny prompts (explicit allows still work) |
| `bypassPermissions` | skip prompts (DANGEROUS) |
| `plan` | read-only exploration |

- Parent `bypassPermissions`/`acceptEdits` takes precedence and cannot be overridden by the child. Parent `auto` → child inherits auto; child `permissionMode` ignored.
- `bypassPermissions` still prompts on explicit `ask` rules and root/home removals (`rm -rf /`), but allows writes to protected dirs `.git`, `.config/git`, `.claude`, `.vscode`, `.idea`, `.husky`, `.cargo`, `.devcontainer`, `.yarn`, `.mvn` — use with extreme caution.

## Conditional rules (finer than `tools`)

- Use `PreToolUse` hook to validate before execution (e.g. allow only `SELECT`):
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
```
- Hook reads JSON on stdin (`.tool_input.command`); **exit code 2** blocks + returns stderr to Claude. Windows: PowerShell script + `shell: powershell`.

## Preload skills into a subagent

```yaml
skills:
  - api-conventions
  - error-handling-patterns
```
- Injects FULL content of each skill at startup. Controls preloading, NOT access: the agent can still discover/invoke project/user/plugin skills via the Skill tool. To forbid skills entirely: omit `Skill` from `tools` or add to `disallowedTools`.
- Cannot preload skills with `disable-model-invocation: true` (missing/disabled → skipped + debug warning).
- Inverse of skill `context: fork` (which injects skill content into the agent you name).

## Persistent memory

| Scope | Location | Use when |
|---|---|---|
| `user` | `~/.claude/agent-memory/<name>/` | learnings span all projects |
| `project` | `.claude/agent-memory/<name>/` | project-specific, shareable via VCS (recommended default) |
| `local` | `.claude/agent-memory-local/<name>/` | project-specific, not checked in |

- When enabled: system prompt gets read/write instructions + first 200 lines / 25KB of `MEMORY.md` (whichever first) with curation guidance; Read/Write/Edit auto-enabled.
- Prompt the agent to consult memory before work and save learnings after; bake memory-maintenance instructions into the body for proactive upkeep.

## Hooks

- **In frontmatter** (run only while this agent active; cleaned up on finish): all hook events. Common: `PreToolUse`, `PostToolUse`, `Stop` (auto-converted to `SubagentStop` when run as a subagent). Fire both when spawned as subagent and when run as main via `--agent`.
- **In `settings.json`** (main-session reactions): `SubagentStart` / `SubagentStop`, matched by agent-type name.

## Delegation & explicit invocation

- **Automatic:** based on request + each agent's `description` + context. "use proactively" in `description` encourages it.
- **Natural language:** name the agent ("Use the test-runner subagent to fix failing tests"); Claude decides.
- **@-mention:** `@"code-reviewer (agent)"` guarantees THAT agent runs for one task (controls which agent, not the prompt). Plugin agents under scoped name; manual `@agent-<name>` / `@agent-my-plugin:code-reviewer`.
- **Session-wide:** `claude --agent <name>` replaces the default system prompt entirely (like `--system-prompt`); CLAUDE.md/memory still load; name shows as `@<name>`; persists on resume. Disambiguate plugins via scoped name. Or set `{"agent": "code-reviewer"}` in `.claude/settings.json` (CLI flag overrides setting).

## Foreground vs background

- **Foreground:** blocks main; permission prompts pass through to you.
- **Background:** concurrent; runs with already-granted permissions and **auto-denies** anything that would prompt; clarifying-question tool calls fail but the agent continues. If it failed on missing perms, re-run in foreground.
- Claude picks fg/bg by task; you can say "run in the background" or press **Ctrl+B**. Disable all bg: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`.

## Common patterns

- **Isolate high-volume ops:** "Use a subagent to run the test suite and report only the failing tests with error messages."
- **Parallel research:** "Research the auth, database, and API modules in parallel using separate subagents." Best when paths are independent. Caveat: many subagents each returning detailed results refill main context — for sustained parallelism use agent teams.
- **Chain:** "Use code-reviewer to find performance issues, then optimizer to fix them." Each returns to Claude, which feeds the next.

## Nested subagents (≥ v2.1.172)

- A subagent can spawn its own subagents (delegated task splits into parallel subtasks; intermediate output never reaches main).
- Depth = subagent levels below main, counted regardless of foreground/background. A subagent at **depth 5** gets no Agent tool and cannot spawn further. Limit is fixed, not configurable.
- Prevent spawning: omit `Agent` from `tools` or add to `disallowedTools`. A fork cannot spawn another fork (but can spawn named types, counting toward depth).

## Forks (≥ v2.1.117; `/fork` default ≥ v2.1.161)

- A fork inherits the ENTIRE conversation (system prompt, tools, model, history) — drops input isolation; its own tool calls stay out of main; only final result returns. First request reuses the parent's prompt cache → cheaper than a fresh subagent for same-context tasks.
- Use when a named subagent would need too much background, or to try several approaches from the same start.
- `CLAUDE_CODE_FORK_SUBAGENT=1` enables (works interactive/headless/SDK); `=0` disables everywhere. When on: Claude forks only by requesting the `fork` subagent type explicitly (per-spawn opt-in); untyped spawns still use `general-purpose` and named subagents (e.g. Explore) spawn as before. Every fork spawn runs in background (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` keeps synchronous).
- Manual: `/fork <directive>`. Panel keys: ↑/↓ move, Enter open+steer, x dismiss/stop, Esc back to prompt.

| | Fork | Named subagent |
|---|---|---|
| Context | full history | fresh + passed prompt |
| Sys prompt/tools | same as main | from definition |
| Model | same as main | from `model` |
| Permissions | prompt in terminal | auto-denied if background |
| Prompt cache | shared with main | separate |

## What loads at a subagent's startup (non-fork)

- Fresh, isolated context: does NOT see conversation history, prior skill invocations, or files already read.
- Contains: agent's own system prompt + env details; the delegation task message Claude writes; full CLAUDE.md/memory hierarchy (`~/.claude/CLAUDE.md`, project rules, `CLAUDE.local.md`, managed policy) — **except Explore/Plan skip CLAUDE.md + git status**; git status snapshot (absent if not a repo or `includeGitInstructions: false`); preloaded `skills` content.
- No frontmatter switch to change which agents skip CLAUDE.md/git. If a rule must reach Explore/Plan (e.g. "ignore `vendor/`"), restate it in the delegation prompt.

## Resume subagents

- Each invocation = new instance with fresh context. To continue, ask Claude to resume → retains full history (tool calls, results, reasoning).
- Explore/Plan are one-shot (no agent ID, not resumable) — use `general-purpose`/custom to continue.
- Resume uses `SendMessage` (agent ID as `to`) — only when agent teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). A stopped agent receiving `SendMessage` auto-resumes in background.
- Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`; survive main compaction; persist within session; cleaned per `cleanupPeriodDays` (default 30). Subagents auto-compact with same logic; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` applies.
- Auto-compaction marker in the transcript: a `type: system` event with `subtype: compact_boundary`, `compactMetadata.trigger: "auto"`, and `compactMetadata.preTokens` (token count before compaction).

## Plugin subagent restrictions

- `hooks`, `mcpServers`, `permissionMode` are IGNORED for plugin agents (security). To use them, copy the file into `.claude/agents/` or `~/.claude/agents/`, or add `permissions.allow` rules in settings (session-wide, not agent-scoped).

## Best practices

- One job per subagent (focused). Detailed `description` (drives delegation; "use proactively" to nudge). Limit tools to the minimum (security + focus). Check project agents into version control. Set `model` deliberately (route cheap/fast work to Haiku via `model: haiku`).

## Disable specific subagents

```json
{ "permissions": { "deny": ["Agent(Explore)", "Agent(my-custom-agent)"] } }
```
Or `claude --disallowedTools "Agent(Explore)"`.

## Version notes

- v2.1.63 Task→Agent rename (alias kept) · v2.1.117 forks · v2.1.153 MCP restrictions cover subagent frontmatter · v2.1.161 `/fork` default-on · v2.1.172 nested subagents · v2.1.178 nearest-cwd wins for duplicate `name` in nested project dirs.
