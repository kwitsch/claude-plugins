# Claude Code Subagents / Agents — Authoring Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Claude Code "Create custom subagents"; Agent SDK "Subagents in the SDK"), verified 2026-08-13.
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
- **Workflow tool** (TypeScript Agent SDK ≥ v0.3.149) when orchestrating dozens-to-hundreds of agents from a script outside the conversation context, instead of turn-by-turn subagent delegation.

## Built-in subagents

| Agent             | Model   | Tools                                           | Purpose                                                                                                                                                                                   |
| ----------------- | ------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore           | inherit | read-only (no Write/Edit)                       | fast file discovery / code search. Specifies thoroughness: quick / medium / very thorough.                                                                                                |
| Plan              | inherit | read-only                                       | research during plan mode before presenting a plan                                                                                                                                        |
| general-purpose   | inherit | every tool available to subagents (post-filter) | complex multi-step exploration + modification                                                                                                                                             |
| claude            | inherit | every tool available to subagents (post-filter) | catch-all when no other built-in fits; default agent for a dispatched background session (`claude --bg`/agent view) — runs under your settings' permission mode, not the parent session's |
| statusline-setup  | Sonnet  | —                                               | auto, on `/statusline`                                                                                                                                                                    |
| claude-code-guide | Haiku   | —                                               | auto, on questions about Claude Code features                                                                                                                                             |

- version >= 2.1.198: Explore inherits the main conversation's model instead of always running on Haiku; on the Claude API the inherited model is capped at Opus (a session on a higher tier runs Explore on Opus; Sonnet/Haiku sessions keep Explore on that same model). On other providers (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, Claude Platform on AWS), Explore inherits the main model directly, uncapped. A user/project subagent literally named `Explore` overrides the built-in and keeps its own `model` field — set `model: haiku` there to keep exploration cheap.
- Explore + Plan **skip CLAUDE.md and git status** (kept small). All other built-in + custom agents load both.
- Block a built-in: `permissions.deny: ["Agent(Explore)"]`. Block all delegation: deny the `Agent` tool. version >= 2.1.198: `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1` removes only the built-in Explore/Plan subagents (Claude reads/explores directly instead). Headless/SDK: `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`.

## Scope & precedence

| Location                   | Scope                | Priority    |
| -------------------------- | -------------------- | ----------- |
| Managed settings           | org-wide             | 1 (highest) |
| `--agents` CLI flag (JSON) | current session      | 2           |
| `.claude/agents/`          | project              | 3           |
| `~/.claude/agents/`        | all your projects    | 4           |
| plugin `agents/` dir       | where plugin enabled | 5 (lowest)  |

- Identity comes only from the `name` field, not the path. Scanned recursively → organize in subfolders (`agents/review/`). Keep `name` unique across the tree: a clash within the same directory (incl. its subfolders) loads only one definition, chosen by filesystem read order — not a documented precedence.
- version >= 2.1.205: `/doctor` reports same-directory duplicate `name`s and proposes renaming/removing all but one. Earlier versions: `/doctor` opens a diagnostics screen listing duplicates and showing which definition is active.
- Plugin subfolders DO scope the identifier: `agents/review/security.md` in `my-plugin` → `my-plugin:review:security`.
- Project agents discovered by walking up from cwd to repo root. version >= 2.1.178: when nested project `.claude/agents/` dirs define the same `name`, the definition closest to cwd wins.
- `--add-dir` dirs ARE scanned: a `.claude/agents/` inside an added dir loads alongside project agents. To share across projects without `--add-dir`, use `~/.claude/agents/` or a plugin.
- File watcher auto-loads `~/.claude/agents/` and `.claude/agents/` edits within seconds — no restart needed for edits to an existing file, or new files in an already-watched dir. Restart still required when: it's the first agent file in a brand-new `agents/` dir (watcher only covers dirs that existed at session start), or the session started with `--disable-slash-commands` (doesn't watch these dirs at all).
- Managed agents = markdown files in `.claude/agents/` inside the managed-settings directory, same frontmatter format; they outrank project + user agents of the same `name`.
- Definitions from ANY scope are also reusable by agent teams: spawning a teammate can reference a subagent type, and the teammate takes that definition's `tools` + `model` with its body appended to the teammate's system prompt as extra instructions.
- version >= 2.1.198: `/agents` no longer opens an interactive wizard — it prints a reminder to ask Claude or edit `.claude/agents/` directly (frontmatter fields/locations unchanged). version <= 2.1.197: `/agents` opens a wizard with a Running tab (live subagents) and a Library tab (create/edit/delete).

## Frontmatter reference

Required: `name`, `description`. Body = system prompt (subagent gets ONLY this + env details, not the full Claude Code system prompt).

| Field             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | lowercase + hyphens, unique. Hooks receive it as `agent_type`. Filename need not match. Can't contain `:` (reserved for plugin-scoped identifiers, e.g. `my-plugin:reviewer`) — version >= 2.1.218: a file whose `name` contains one fails to load (error logged to debug log); earlier versions accepted it.                                                                                                                                                                 |
| `description`     | when Claude should delegate here. Add "use proactively" to encourage delegation.                                                                                                                                                                                                                                                                                                                                                                                              |
| `tools`           | allowlist; inherits every tool available to subagents if omitted. Use `skills` field (not `Skill` here) to preload skills. Accepts MCP server-level patterns: `mcp__<server>` or `mcp__<server>__*` grants every tool from that server. version >= 2.1.208: if nothing in the list resolves to a tool, the subagent usually refuses to launch and the Agent tool errors naming the unresolved entries; earlier versions launched it with zero tools (empty/confusing result). |
| `disallowedTools` | denylist; removed from inherited/specified set. Accepts MCP patterns: `mcp__<server>` / `mcp__<server>__*` removes every tool from that server; `mcp__*` removes every MCP tool from any server.                                                                                                                                                                                                                                                                              |
| `model`           | `sonnet\|opus\|haiku\|fable`, full ID (`claude-opus-5`, `claude-sonnet-5` — same values as `--model`), or `inherit`. Default `inherit`.                                                                                                                                                                                                                                                                                                                                       |
| `permissionMode`  | `default\|acceptEdits\|auto\|dontAsk\|bypassPermissions\|plan`, or (v2.1.200+) `manual` as an alias for `default`. Ignored for plugin agents.                                                                                                                                                                                                                                                                                                                                 |
| `maxTurns`        | max agentic turns before stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `skills`          | preload FULL skill content at startup (not just description).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `mcpServers`      | inline defs or name refs; scope MCP to this agent. Ignored for plugin agents.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hooks`           | lifecycle hooks scoped to this agent. Ignored for plugin agents.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `memory`          | `user\|project\|local` → persistent cross-session memory dir. Part of auto memory: with auto memory off (`autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY`) the field has NO effect — no memory instructions, no auto Read/Write/Edit.                                                                                                                                                                                                                          |
| `background`      | `true` forces background run; omitted → Claude decides (v2.1.198+: background by default, foreground only when the result is needed immediately; earlier: chosen per-task). No effect when `CLAUDE_CODE_FORK_SUBAGENT=1` (fork mode always backgrounds).                                                                                                                                                                                                                      |
| `effort`          | `low\|medium\|high\|xhigh\|max`; overrides session. Model-dependent.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `isolation`       | `worktree` → run in a temp git worktree (isolated repo copy; auto-cleaned if no changes; branches from the **default branch**, not the parent session's `HEAD`).                                                                                                                                                                                                                                                                                                              |
| `color`           | `red\|blue\|green\|yellow\|purple\|orange\|pink\|cyan` for UI.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `initialPrompt`   | auto-submitted first user turn when the agent runs as the main session agent (`--agent` or the `agent` setting); commands/skills processed; prepended to user prompt. Ignored when it is invoked as a subagent.                                                                                                                                                                                                                                                               |

`--agents` JSON accepts the same fields; use `prompt` for the system prompt (= markdown body).

- A subagent starts in the main conversation's cwd; `cd` doesn't persist between Bash/PowerShell calls within it and doesn't affect the main conversation's cwd. `isolation: worktree` gives it an isolated repo copy instead.
- version >= 2.1.203: with `isolation: worktree`, the subagent's Bash/PowerShell commands run inside that worktree; a command whose cwd resolves to the main checkout instead (e.g. the worktree was removed mid-run) fails with an error. Earlier versions: such a command could silently run in the main checkout.
- version >= 2.1.210: that cwd check covers the WHOLE repo containing the launch dir (and, when the session itself runs in a linked worktree, the main checkout it links from). Earlier versions: only the launch dir itself — a command resolving elsewhere in the same repo (e.g. the repo root from a monorepo subdir) ran there instead of failing.
- version >= 2.1.216: Bash commands are also checked for content — redirecting git into the main checkout fails (`git -C`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, or a leading `cd`), and a command too complex to check fails with an error telling Claude to split it into separate plain commands. Bash only; PowerShell gets the cwd check alone.
- Headless mode: `--append-subagent-system-prompt <text>` (v2.1.205+) appends to the end of every subagent's system prompt, including nested subagents.

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

- version >= 2.1.196: `CLAUDE_CODE_SUBAGENT_MODEL=inherit` is treated as unset — resolution falls through to the per-invocation param then frontmatter. Earlier versions: `inherit` forced the main conversation's model and skipped both of those sources.
- Each resolved value (env var, per-invocation param, frontmatter) is checked against org `availableModels`. version >= 2.1.222: a blocked family alias (e.g. `opus`) substitutes the newest version of that family the allowlist permits (same substitution + provider-scope rules as `/model`); any other blocked value, or a blocked family alias where that substitution doesn't apply, falls back to the main conversation's model. Earlier versions: any blocked value — including a blocked family alias — fell back to the main conversation's model. Interactive sessions show a warning naming the requested + actual model for either substitution.
- version >= 2.1.211: a per-invocation `model` param also applies when the subagent is resumed or sent a follow-up, so it stays on that model. Earlier versions: resuming dropped it and fell back to frontmatter `model`, else the main conversation's model.
- version >= 2.1.198: subagent inherits the main conversation's extended-thinking setting (on stays on, off stays off) — no per-subagent thinking config. Earlier versions: subagents always ran with extended thinking disabled regardless of the main conversation's setting.

## Tool & capability control

- **Restrict tools:** `tools:` (allowlist) OR `disallowedTools:` (denylist). If both: denylist applied first, then allowlist against the remainder; a tool in both is removed.
- **MCP server-level patterns** in either field: `mcp__<server>` / `mcp__<server>__*` = every tool from that server; in `disallowedTools`, `mcp__*` = every MCP tool from any server.
- **Base pool:** a subagent inherits the main conversation's built-in + MCP tools, then TWO filters narrow it. Forks skip both filters and get the main conversation's exact pool.
- **Filter 1 — stripped from EVERY subagent**, even when listed in `tools`: `Agent` (until nested spawning is turned on; in a fork it stays listed but errors instead of spawning), `AskUserQuestion`, `EndConversation` (can only end the main conversation), `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `ScheduleWakeup`, `TaskOutput`, `WaitForMcpServers`, `Workflow`.
- **Filter 2 — background subagents only** (= the default since v2.1.198): keeps every MCP tool, but only these built-ins: `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, `Artifact`. Every other built-in is removed whether inherited or listed → **the same definition resolves to a different tool set in foreground vs background**. Removal is silent unless it leaves `tools` resolving to nothing. `Agent` + `ExitPlanMode` follow filter 1's conditions wherever the subagent runs. `ListAgents` (cross-session messaging) follows the same filters as any built-in: a foreground subagent inherits it when the session has cross-session messaging enabled; a background subagent does not keep it.
- Agent-teams teammates additionally keep the task + cron tools: `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `CronCreate`, `CronDelete`, `CronList`.
- **Restrict which agents a main-thread agent may spawn** (only under `claude --agent`): `tools: Agent(worker, researcher)` (allowlist; other types fail and the agent only sees the allowed types). `Agent` w/o parens = any; omit `Agent` = none. To block specific types while allowing the rest use `permissions.deny` instead. In a _subagent_ definition, the type-list inside parens is ignored — listing `Agent` only lets it spawn nested agents once nested spawning is enabled (see Nested subagents).

## MCP scoping

- `mcpServers:` entries = inline def (`stdio|http|sse|ws`, same schema as `.mcp.json`) connected for the agent's lifetime, OR a string name reusing the parent's connection.
- Define an MCP server inline here (not in `.mcp.json`) to keep its tool descriptions OUT of the main conversation's context.
- As of v2.1.153, managed-MCP restrictions, `--strict-mcp-config`, `--bare`, and allow/deny policies also cover subagent-frontmatter servers (blocked → skipped + warning). `--strict-mcp-config` does NOT filter servers passed via `--agents`/SDK `agents` (explicit caller input).

## Permission modes

| Mode                | Behavior                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`           | standard prompts                                                                                                                                                                           |
| `acceptEdits`       | auto-accept edits + common fs commands in cwd/additionalDirectories                                                                                                                        |
| `auto`              | background classifier reviews commands + protected-dir writes                                                                                                                              |
| `dontAsk`           | auto-deny prompts (explicit allows still work, EXCEPT `AskUserQuestion`, connector tools your org set to `ask`, and MCP tools marked `requiresUserInteraction` — denied even when allowed) |
| `bypassPermissions` | skip prompts (DANGEROUS)                                                                                                                                                                   |
| `plan`              | read-only exploration                                                                                                                                                                      |

- Parent `bypassPermissions`/`acceptEdits` takes precedence and cannot be overridden by the child. Parent `auto` → child inherits auto; child `permissionMode` ignored — classifier evaluates the subagent's tool calls with the parent session's same block/allow rules.
- `bypassPermissions` still prompts on explicit `ask` rules, connector tools your org set to `ask`, MCP tools marked `requiresUserInteraction`, root/home removals (`rm -rf /`), and the `isolatePeerMachines` approval for messages beyond this machine, but allows writes to protected dirs `.git`, `.config/git`, `.claude`, `.vscode`, `.idea`, `.husky`, `.cargo`, `.devcontainer`, `.yarn`, `.mvn` — use with extreme caution.
- version >= 2.1.223: if `permissions.disableBypassPermissionsMode` disables bypass mode, a subagent's frontmatter `permissionMode: bypassPermissions` is ignored and it runs with the parent session's mode instead. Earlier versions applied the frontmatter mode regardless.

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
- Cannot preload skills with `disable-model-invocation: true` — preloading draws from the same set Claude may invoke (missing/disabled → skipped + debug warning). version >= 2.1.215: this also covers the bundled `/verify` and `/code-review` skills (user-only, so not preloadable).
- Inverse of skill `context: fork` (which injects skill content into the agent you name).

## Persistent memory

| Scope     | Location                             | Use when                                                  |
| --------- | ------------------------------------ | --------------------------------------------------------- |
| `user`    | `~/.claude/agent-memory/<name>/`     | learnings span all projects                               |
| `project` | `.claude/agent-memory/<name>/`       | project-specific, shareable via VCS (recommended default) |
| `local`   | `.claude/agent-memory-local/<name>/` | project-specific, not checked in                          |

- When enabled: system prompt gets read/write instructions + first 200 lines / 25KB of `MEMORY.md` (whichever first) with curation guidance; Read/Write/Edit auto-enabled.
- Subagent memory is part of auto memory: turn auto memory off (`autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY`) and `memory:` becomes a no-op — the agent launches without the memory instructions and without the auto tool access.
- Prompt the agent to consult memory before work and save learnings after; bake memory-maintenance instructions into the body for proactive upkeep.

## Hooks

- **In frontmatter** (run only while this agent active; cleaned up on finish): all hook events. Common: `PreToolUse`, `PostToolUse`, `Stop` (auto-converted to `SubagentStop` when run as a subagent). Fire both when spawned as subagent and when run as main via `--agent`; in the main-session case they run alongside any `settings.json` hooks.
- **In `settings.json`** (main-session reactions): `SubagentStart` / `SubagentStop`, matched by agent-type name.
- Matcher value = agent's frontmatter `name` (project/user) or plugin-scoped id (`my-plugin:db-agent`). A scoped name contains `:` so it's evaluated as an unanchored regex — anchor with `^...$` to match only that agent. version >= 2.1.195: a plain hyphenated matcher (e.g. `db-agent`) matches exactly; earlier versions treat it as an unanchored regex too (also fires on `prod-db-agent`) — anchor as `^db-agent$` there.

## Delegation & explicit invocation

- **Automatic:** based on request + each agent's `description` + context. "use proactively" in `description` encourages it.
- **Natural language:** name the agent ("Use the test-runner subagent to fix failing tests"); Claude decides.
- **@-mention:** `@"code-reviewer (agent)"` guarantees THAT agent runs for one task (controls which agent, not the prompt). Plugin agents under scoped name; manual `@agent-<name>` / `@agent-my-plugin:code-reviewer`. Named background subagents still running in the session also appear in the typeahead with their status.
- **Session-wide:** `claude --agent <name>` replaces the default system prompt entirely (like `--system-prompt`); CLAUDE.md/memory still load; name shows as `@<name>`; persists on resume (system prompt + tool restrictions + model restored). Disambiguate plugins via scoped name. Or set `{"agent": "code-reviewer"}` in `.claude/settings.json` (CLI flag overrides setting).
- version >= 2.1.216: resuming a session whose `--agent`/`agent`-setting agent no longer exists continues with the DEFAULT tools + system prompt and warns naming the missing agent.

## Foreground vs background

- **Foreground:** blocks main; permission prompts pass through to you.
- **Background:** concurrent. version >= 2.1.186: a permission prompt surfaces in the main session naming the asking subagent — approve to let it continue, or Esc to deny just that call without stopping the subagent. Earlier versions: auto-denied anything that would prompt.
- version >= 2.1.198: subagents run in the background by default; Claude runs foreground only when it needs the result before continuing. Earlier versions: Claude chose fg/bg per task. Either way, background subagents still surface every permission prompt in the main session — the default change is WHERE a subagent runs, not what it may do. Background runs also get a **smaller built-in tool set** (filter 2, see Tool & capability control) — forks excepted.
- Omitting the Agent tool's `run_in_background` param now launches background (v2.1.198+); Claude sets it `false` when it needs the result immediately. Frontmatter `background: true` forces background regardless of what Claude requests.
- version >= 2.1.211: a background subagent's results reach Claude as a completion notification in a later turn; Claude waits for it before reporting results, and answers "still running" if asked for progress first. Earlier versions: Claude sometimes reported results for a background subagent that had not finished.
- version >= 2.1.208: a completed background subagent stays listed in `/tasks`, marked done and sorted below running work, until the session cleans up the task list; its detail view stays open. Failed or stopped subagents leave the list. Earlier versions: a completed subagent left the list immediately and its detail view closed.
- Claude picks fg/bg by task; you can say "run in the background" or press **Ctrl+B**. Disable all bg: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` — it takes precedence over fork mode and keeps subagents in the foreground.

## API errors in subagents (≥ v2.1.199)

- A subagent run that ends on an API error (rate limit, repeated server error) reports the failure to Claude instead of returning the error text as if it were the subagent's result.
- **Foreground:** if the subagent already produced text output before being cut off, the Agent tool returns that partial output with a note that it didn't finish (unchanged since v2.1.199). For a cutoff with no text output (tool calls only): version >= 2.1.200 fails the tool call with `Agent terminated early due to an API error` plus detail; v2.1.199 instead returned an empty partial result containing only the cutoff note.
- **Background:** the subagent is marked failed; the message Claude receives names the API error and includes the subagent's last output.
- Once the API error clears, ask Claude to retry or resume the subagent.

## Subagent output scanning (≥ v2.1.210)

- Every subagent's final report is scanned for instruction-shaped patterns before the parent reads it (a subagent may have read files/pages/command output nobody reviewed). The scan NEVER removes or rewords text; it only annotates.
- Control-tag imitation (e.g. a `<system-reminder>` block): a backslash is inserted after the opening angle bracket, in place.
- Turn markers (a line starting `Human:` / `Assistant:`): a backslash goes before the colon. No marker line added.
- Permission-configuration mentions (`.claude/settings.json`, `bypassPermissions`, `--dangerously-skip-permissions`): text kept as written.
- Control-tag + permission-configuration matches also get a prepended `[harness: subagent output matched instruction-shaped pattern(s): …]` line naming the matches.
- Not a security boundary: the scan makes no maliciousness judgement, and a tool call the report leads Claude to make still goes through the session's permission checks + sandboxing. Restrict what the subagent can reach instead.

## Subagent count limits

Two independent caps: concurrently running, and nesting depth (see Nested subagents). There is no limit on the total number of subagents Claude can spawn over a session.

| Limit      | Default | Env var                                | Error on hit                        | Gate       |
| ---------- | ------- | -------------------------------------- | ----------------------------------- | ---------- |
| Concurrent | 20      | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | `Concurrent subagent limit reached` | ≥ v2.1.217 |

- Accepts any positive whole number; can't be turned off. Sessions with ultracode active are exempt. On hit, the error also tells Claude not to retry; spawning succeeds again once the running count drops below the limit.
- Blocks only Agent-tool spawns: an in-session `/subtask` fork occupies a slot but is never blocked, and resuming an already-finished subagent takes a fresh slot without checking the limit (so resumes can push the running count past it). Workflow agents and agent-team teammates follow their own limits.

## Common patterns

- **Isolate high-volume ops:** "Use a subagent to run the test suite and report only the failing tests with error messages."
- **Parallel research:** "Research the auth, database, and API modules in parallel using separate subagents." Best when paths are independent. Caveat: many subagents each returning detailed results refill main context — for sustained parallelism use agent teams.
- **Chain:** "Use code-reviewer to find performance issues, then optimizer to fix them." Each returns to Claude, which feeds the next.

## Nested subagents

- version >= 2.1.219: subagents nest **up to 3 layers below the main conversation by default** — a subagent may spawn a subagent, which may spawn one more, and that third layer cannot delegate further. At the depth limit the `Agent` tool is withheld from every subagent except a fork, where it stays listed but returns an error instead of spawning; a subagent hitting the limit does the delegated work itself and returns one summary.
- Change the limit with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` = number of layers below the main conversation. Set `1` to turn nesting off entirely. In `settings.json` `env`:

```json
{ "env": { "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "2" } }
```

- version 2.1.217–2.1.218: default was `1` (nesting off) — the same env var raised it.
- version <= 2.1.216 (from v2.1.172): subagents nested by default, up to five layers, limit not configurable.
- A nested subagent is configured like a top-level one and resolves from the same scopes. Keep one from spawning while nesting is on: omit `Agent` from `tools` or add it to `disallowedTools`.
- Use for a delegated task that itself splits into parallel subtasks (e.g. a reviewer dispatching a verifier per finding) — intermediate output never reaches main; only the top-level summary returns.
- The subagent panel below the prompt shows the full tree: each row shows a `(+N)` descendant count. version >= 2.1.193: opening a row shows that subagent's siblings and direct children with a path back to `main`.
- A fork cannot spawn another fork.

## Forks (≥ v2.1.117)

- A fork inherits the ENTIRE conversation (system prompt, tools, model, history) — drops input isolation; skips both subagent tool filters; its own tool calls stay out of main; only final result returns. First request reuses the parent's prompt cache → cheaper than a fresh subagent for same-context tasks.
- Use when a named subagent would need too much background, or to try several approaches from the same start.
- `CLAUDE_CODE_FORK_SUBAGENT=1` enables (works interactive/headless/SDK); `=0` disables everywhere (including any server-side staged rollout). When on: Claude forks only by requesting the `fork` subagent type explicitly (per-spawn opt-in); untyped spawns still use `general-purpose` and named subagents (e.g. Explore) spawn as before. Every subagent spawn — fork or named — runs in background while fork mode is on (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` takes precedence and keeps subagents synchronous); frontmatter `background` has no effect in this mode since fork mode removes the Agent tool's `run_in_background` param. Letting Claude spawn forks itself is experimental.
- Claude can pass `isolation: worktree` when spawning a fork so its file edits land in a separate git worktree instead of your checkout.
- **Manual: `/subtask <directive>`** (version >= 2.1.212; works with or without the env var; Claude Code names the fork from the first words of the task). In that version range `/fork` instead copies the whole session into a new background session with its own budget — EXCEPT when agent view is turned off, where `/subtask` is unavailable and `/fork` starts the forked subagent.
- version 2.1.161–2.1.211: the forked-subagent command is `/fork`, enabled by default. version 2.1.117–2.1.160: `/fork` required `CLAUDE_CODE_FORK_SUBAGENT=1` unless a server-side rollout enabled it.
- Panel keys: ↑/↓ move, Enter open+steer, x dismiss/stop, Esc back to prompt. With a transcript open, follow-up messages and skills go to that agent, but built-in commands still run in the main conversation.
- version >= 2.1.199: typing `/model` or `/fast` in an open fork/subagent transcript view shows a notice that it changes the main conversation's setting, not the viewed agent's, instead of applying it there silently.

|                  | Fork               | Named subagent                                         |
| ---------------- | ------------------ | ------------------------------------------------------ |
| Context          | full history       | fresh + passed prompt                                  |
| Sys prompt/tools | same as main       | from definition, filtered for background runs          |
| Model            | same as main       | from `model`                                           |
| Permissions      | prompt in terminal | surfaces in main session when backgrounded (v2.1.186+) |
| Prompt cache     | shared with main   | separate                                               |

## What loads at a subagent's startup (non-fork)

- Fresh, isolated context: does NOT see conversation history, prior skill invocations, or files already read.
- Contains: agent's own system prompt + env details; the delegation task message Claude writes; full CLAUDE.md/memory hierarchy (`~/.claude/CLAUDE.md`, project rules, `CLAUDE.local.md`, managed policy) — **except Explore/Plan skip CLAUDE.md + git status**; git status snapshot (absent if not a repo or `includeGitInstructions: false`); preloaded `skills` content.
- version >= 2.1.206: also a **sibling roster** — a system reminder listing `main` and every other named agent in the session, each a valid `to` for `SendMessage`. Appears only when the subagent's tools include `SendMessage` and at least one other agent has a name (Claude-named or an agent-team teammate). Snapshot taken at start → agents named later don't appear. Forks don't get it (they inherit the parent conversation).
- No frontmatter switch to change which agents skip CLAUDE.md/git. If a rule must reach Explore/Plan (e.g. "ignore `vendor/`"), restate it in the delegation prompt. The main conversation reads their results with full CLAUDE.md context, so most rules need not reach the subagent.
- Never reaches a non-fork subagent: the main conversation's **output style** (the subagent runs its own system prompt), the main conversation's **auto memory** (use the `memory` field for per-agent persistence), and the parent's **context-window size** — a subagent's window is sized by its OWN model, so delegating to a smaller-window model gives it the smaller window.

## Resume subagents

- Each invocation = new instance with fresh context. To continue, ask Claude to resume → retains full history (tool calls, results, reasoning).
- Explore/Plan are one-shot (no agent ID, not resumable) — use `general-purpose`/custom to continue.
- Resume uses `SendMessage` (agent ID or name as `to`). `SendMessage` does NOT require agent teams to be enabled — only structured team-protocol messages (`shutdown_request`, `plan_approval_response`) do. A completed agent — or one Claude stopped via the `TaskStop` tool — auto-resumes in background on `SendMessage`, with no new `Agent` invocation.
- version >= 2.1.191: a subagent YOU stopped (`x` in `/tasks`, or an SDK `stop_task` request) does NOT auto-resume — `SendMessage` returns a refusal telling Claude the agent was cancelled. Type into that subagent's transcript in the panel to resume it yourself; that clears the stop so later `SendMessage` calls auto-resume again.
- version >= 2.1.199: `SendMessage` verifies a name still refers to the agent reached earlier in the conversation; if a newer agent has since taken that name (e.g. a re-spawned background agent), the send is refused — the error names the current holder so Claude can retarget — rather than misdelivering. To reach the earlier agent while it's still running, address it by its spawn-result agent ID. Check is scoped to the conversation and resets on `/clear`.
- version >= 2.1.198: a subagent treats messages from the agent that launched it as normal task direction, including mid-task course corrections, and acts on them within its own permission settings. No message from any agent — regardless of sender — counts as your approval for a pending permission prompt, or can change a subagent's permission settings, `CLAUDE.md`, or configuration; only the permission system or your own messages grant approval.
- Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`; survive main compaction; persist within session; cleaned per `cleanupPeriodDays` (default 30). Subagents auto-compact with same logic; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` applies.
- Auto-compaction marker in the transcript: a `type: system` event with `subtype: compact_boundary`, `compactMetadata.trigger: "auto"`, and `compactMetadata.preTokens` (token count before compaction).
- version >= 2.1.205: resuming restarts the same agent ID's run, so a previously failed/completed subagent shows as running again in the task list and in the Agent SDK's task events while the resumed run works. Earlier versions: it kept showing the earlier failed/completed status during the resumed run.

## Plugin subagent restrictions

- `hooks`, `mcpServers`, `permissionMode` are IGNORED for plugin agents (security). To use them, copy the file into `.claude/agents/` or `~/.claude/agents/`, or add `permissions.allow` rules in settings (session-wide, not agent-scoped).

## Best practices

- One job per subagent (focused). Detailed `description` (drives delegation; "use proactively" to nudge). Limit tools to the minimum (security + focus). Check project agents into version control. Set `model` deliberately (route cheap/fast work to Haiku via `model: haiku`).
- Claude Opus 5 delegates to subagents more readily than earlier models — set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`/`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (and, in the SDK, `maxBudgetUsd`/`max_budget_usd`) deliberately on any run that may use it. The `claude_code` system-prompt preset adds a line telling Opus 5 not to call `Agent` unless asked; a custom or absent system prompt doesn't get that line — add the Opus 5 prompting guide's delegation instruction to your own prompt instead.

## Disable specific subagents

```json
{ "permissions": { "deny": ["Agent(Explore)", "Agent(my-custom-agent)"] } }
```

Or `claude --disallowedTools "Agent(Explore)"`.

## SDK subagents (programmatic `agents` option)

Agent SDK "Subagents in the SDK". Applies to the `agents` param passed to `query()` (TS/Python) — distinct from `.claude/agents/*.md` files; use when orchestrating from a script rather than interactive Claude Code.

| Field                                                                                                                                        | Notes                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `description`, `prompt`                                                                                                                      | required; `prompt` = system prompt (no separate frontmatter/body split).                                         |
| `tools`, `disallowedTools`, `model`, `skills`, `memory`, `mcpServers`, `initialPrompt`, `maxTurns`, `background`, `effort`, `permissionMode` | same semantics as the matching frontmatter field. `effort` also accepts a raw `number`, not just the level enum. |
| —                                                                                                                                            | no `hooks`, `isolation`, or `color` field — frontmatter/`--agents`-CLI-JSON only.                                |

- Python SDK keeps camelCase for multi-word fields (`disallowedTools`, `mcpServers`) to match the wire format — not snake_case.
- Programmatic `agents` definitions override a filesystem-based agent of the same `name` (a common cause of a filesystem agent appearing not to load, alongside invalid frontmatter or a duplicate `name`).
- Subagents nest up to 3 layers below the main agent by default here too (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` controls it — see Nested subagents and Cap subagent depth, concurrency, and spend below).
- Include `Agent` in `allowedTools` to auto-approve subagent invocations; otherwise they fall through to the `canUseTool` callback, or are denied outright in `dontAsk` mode.
- Detect invocation: `tool_use` block `name === "Agent"` (renamed from `"Task"` at v2.1.63); the `system:init` tools list and `result.permission_denials[].tool_name` still report `"Task"` — check both when matching.
- CLAUDE.md/project memory reaches a subagent only if the parent `query()` sets `settingSources` to include it — not automatic the way it is in interactive Claude Code.
- Parent gets the subagent's final message verbatim as the Agent tool result but may summarize it in its own reply; instruct the subagent (or the main call's `systemPrompt`) explicitly if verbatim output must reach the user.
- Resume programmatically: capture `session_id` from a message during the first `query()`, parse `agentId` from the Agent tool result text (`agentId: <id>`), then pass `resume: sessionId` plus the same agent definitions on the next `query()` call, referencing the agent ID in the prompt.
- Windows: very long subagent prompts can fail (CLI length limit 8191 chars) — keep prompts concise or use filesystem-based agents.

### Cap subagent depth, concurrency, and spend (TS SDK ≥ v0.3.219, Python SDK ≥ v0.2.127; bundles Claude Code ≥ v2.1.219)

| Cap         | Set via                                                      | Default                                                          | At the limit                                                                                                                             |
| ----------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Depth       | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (via `env` option)    | 3 layers below main agent; `1` disables                          | bottom-layer subagent does the work itself instead of spawning                                                                           |
| Concurrency | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (via `env` option)    | 20 running at once                                               | refuses to spawn, returns `Concurrent subagent limit reached`; ultracode sessions exempt                                                 |
| Spend       | `maxBudgetUsd` (TS) / `max_budget_usd` (Python) query option | no limit; compared to `total_cost_usd` (subagent requests count) | refuses to spawn more subagents (`Budget limit reached`), stops running background subagents, ends the query with `error_max_budget_usd` |

- TS SDK's `env` option REPLACES the subprocess environment — spread `process.env` into it to keep `PATH`; Python SDK's `env` MERGES into the inherited environment.

## Version notes

- v2.1.63 Task→Agent rename (alias kept) · v2.1.117 forks (`/fork`, env-gated) · v2.1.153 MCP restrictions cover subagent frontmatter · v2.1.161 `/fork` forked subagent default-on · v2.1.172 nested subagents default-on (through v2.1.216) · v2.1.178 nearest-cwd wins for duplicate `name` in nested project dirs.
- v2.1.186 background subagent permission prompts surface in main session (no more auto-deny) · v2.1.191 a subagent YOU stopped no longer auto-resumes on `SendMessage` (refusal instead) · v2.1.193 subagent panel row expands to show siblings/direct children · v2.1.195 hyphenated `SubagentStart`/`SubagentStop` matcher matches exactly (was unanchored regex) · v2.1.196 `CLAUDE_CODE_SUBAGENT_MODEL=inherit` ≡ unset.
- v2.1.198 Explore inherits main model instead of always Haiku (capped Opus on Claude API); subagents run in background by default; subagents inherit main conversation's extended-thinking setting; `/agents` wizard removed (prints reminder instead); `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1` added.
- v2.1.199 API errors reported as subagent failures (not returned as fake results); `SendMessage` refuses delivery to a name reused by a newer agent; `/model`/`/fast` inside a fork/subagent transcript view now shows a notice instead of silently applying.
- v2.1.200 `manual` permissionMode alias (= `default`); tool-calls-only API-error cutoff now fails the call with `Agent terminated early due to an API error` (v2.1.199 returned an empty partial result instead).
- v2.1.203 `isolation: worktree` subagent Bash/PowerShell commands run inside the worktree; a command resolving outside it fails instead of silently running in the main checkout.
- v2.1.205 `/doctor` proposes renaming/removing duplicate same-directory agent `name`s (was a diagnostics screen); `--append-subagent-system-prompt` CLI flag added; a resumed subagent shows as running (not stale failed/completed) in the task list/SDK events.
- v2.1.206 sibling roster injected at startup for subagents holding `SendMessage`.
- v2.1.208 a `tools` list resolving to nothing refuses to launch with a naming error (was: launched with zero tools); a completed background subagent stays listed in `/tasks` marked done (was: left immediately).
- v2.1.210 subagent output scanning added; `isolation: worktree` cwd check widened from the launch dir to the whole repo (plus the linked main checkout).
- v2.1.211 per-invocation `model` survives resume/follow-up (was: dropped); background results arrive as a completion notification Claude waits for (was: sometimes reported early).
- v2.1.212 forked subagent moves to `/subtask`, `/fork` becomes a new background session (except with agent view off); per-session cap of 200 subagents via `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`.
- v2.1.215 bundled `/verify` + `/code-review` skills cannot be preloaded via `skills`.
- v2.1.216 `isolation: worktree` also content-checks Bash commands for git redirection into the main checkout; resuming a session whose `--agent` no longer exists falls back to default tools/prompt with a warning.
- v2.1.217 nested-spawn depth default drops to `1` (off) — configurable via `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (was: on, five fixed layers, since v2.1.172); concurrent cap of 20 running subagents via `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (ultracode sessions exempt). Current docs no longer mention the v2.1.212 per-session total cap (200, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`) and state there is no limit on the total subagents per session — treat that cap as removed.
- v2.1.218 `name` frontmatter can't contain `:` — a file whose name does is not loaded (was accepted).
- v2.1.219 nested-subagent default depth raised to 3 layers below main (was `1`/off, since v2.1.217).
- v2.1.222 a blocked family-alias `model` (e.g. `opus`) substitutes the newest allowlisted version of that family instead of falling back to the inherited model.
- v2.1.223 `permissions.disableBypassPermissionsMode` also overrides a subagent's frontmatter `permissionMode: bypassPermissions` (was: frontmatter mode still applied).
