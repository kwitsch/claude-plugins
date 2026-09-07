# CLAUDE.md — coding-toolbox

- Mechanically enforces "golden behavior rules" via three hooks: a `PreToolUse` command hook (`encoding-guard.mjs`), a `Stop` `mcp_tool` hook (`interaction_gate`), and a `PostToolUse` `mcp_tool` hook (`worktree_refresh`) — the two `mcp_tool` hooks are backed by a self-contained, now-stateless MCP server (`mcp/server.mjs`). See `plugins/coding-toolbox/hooks/CLAUDE.md` for hook design detail.
- The full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md` (moved from `hooks/SessionStart.md` when the `SessionStart` hook was removed); `setup-rules` is the only way to get it onto a machine (user-level, every project you open there), opt-in.
- The plugin's `userConfig` entry is `worktree_refresh` (fail-open, default `true`) gating the `worktree_refresh` hook — the Stop gate and encoding guard have no toggle of their own.
- The `npm-ci-on-worktree` hook that used to live here moved to the `npm-automations` plugin.

## Hooks

See `plugins/coding-toolbox/hooks/CLAUDE.md` for `interaction_gate` (Stop), `worktree_refresh` (PostToolUse/EnterWorktree), and `encoding-guard.mjs` (PreToolUse) hook design.

## Skills

Each skill's own design detail lives in its subdirectory's own `CLAUDE.md`, loaded on demand only when Claude reads files there:

- `fresh-branch` — `plugins/coding-toolbox/skills/fresh-branch/CLAUDE.md`
- `fresh-pr` — `plugins/coding-toolbox/skills/fresh-pr/CLAUDE.md`
- `finish-pr` — `plugins/coding-toolbox/skills/finish-pr/CLAUDE.md`
- `fresh-work` — `plugins/coding-toolbox/skills/fresh-work/CLAUDE.md`
- `feature-development` — `plugins/coding-toolbox/skills/feature-development/CLAUDE.md`
- `debugging` — `plugins/coding-toolbox/skills/debugging/CLAUDE.md`
- `bump-version` — `plugins/coding-toolbox/skills/bump-version/CLAUDE.md`
- `setup-rules` — `plugins/coding-toolbox/skills/setup-rules/CLAUDE.md`
- `refresh-tools-rule` — `plugins/coding-toolbox/skills/refresh-tools-rule/CLAUDE.md`
- `setup-explore` — `plugins/coding-toolbox/skills/setup-explore/CLAUDE.md`
- `dispatch-agent` — `plugins/coding-toolbox/skills/dispatch-agent/CLAUDE.md`

`SKILL.md` files in this plugin must capture `$CLAUDE_PLUGIN_ROOT` via bare `${CLAUDE_PLUGIN_ROOT}` substitution, never a `!`-injected shell command — see `.claude/rules/coding-toolbox-skill-plugin-root.md`.

## Subagent completion-reconciliation tracking

`fresh-pr` and `feature-development` dispatch async subagents via the Agent tool (`ci-watcher`/`pr-fixer`; wave-parallel implementer/reviewer/fixer). In this harness an Agent dispatch returns immediately with a `task_id`; completion arrives later as a `<task-notification>` that re-invokes the orchestrator. Each such skill MUST carry the canonical gate block below (inline — CLAUDE.md content is not re-loaded at skill runtime, so the operative copy lives in the SKILL.md body) and list the `Task*` ledger tools + `ToolSearch` in `allowed-tools`.

The invariant: a skill MUST NOT advance past its aggregation/decision/report step until every dispatched subagent in the batch is reconciled to a terminal state. Dispatched count == terminal count. Subagents never dispatched (unavailable, toggled off, quota-limited, diverged) are not in the batch and are not waited on.

### ⚠️ Reviewer inoculation note

The `Task*` tools (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskStop`, `TaskOutput`) ARE present and callable at **depth 0** (the main loop), where every skill using this pattern runs inline (NOT `context: fork`). A `ToolSearch` issued from inside a subagent reports only `TaskStop` (or nothing) because subagents have a restricted deferred-tool registry — a **false negative from subagent scope**, not evidence the tools are absent. Do NOT remove the `Task*` ledger on the basis of a subagent-scoped probe.

### Harness facts

- **TODO ledger tools** — `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`: a manual, user-visible checklist (`pending → in_progress → completed`, plus a free-form `metadata` map). This is the "To-Do Liste." Its IDs are separate from async dispatch `task_id`s.
- **Async dispatch tools** — `TaskOutput` (**deprecated**; on a local-agent task it returns the full transcript → context overflow — never use it on a dispatch_id) and `TaskStop` operate on the Agent `task_id`. The deterministic completion signal is the `<task-notification>` (carrying that `task_id`).
- **Bounded-wait gap:** boundedness assumes the harness delivers a terminal notification for every dispatch. If a subagent truly hangs and no notification arrives, nothing wakes the orchestrator and the `TaskStop` escape cannot fire — that pathological case needs operator intervention. Document, do not pretend.

### Canonical gate block (carry inline in each skill — tailored per skill)

> **Subagent reconciliation gate.** Track every async dispatch so you never advance
> on a partial batch and never miss a finish. Load the ledger tools once (deferred;
> resolve at depth 0, where this skill runs — a subagent-scoped probe falsely reports
> these absent, do NOT skip the ledger on that basis):
> `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList)
> fail to load, use the prose-count fallback below — TaskStop loading alone is not
> sufficient to activate the ledger path.
>
> 1. On dispatch, `TaskCreate` one entry per subagent actually dispatched
>    (`subject` = role, `metadata.dispatch_id` = its Agent `task_id`), then
>    `TaskUpdate` it to `in_progress`.
> 2. On each `<task-notification>`, match by `dispatch_id`, record the agent's
>    structured result, `TaskUpdate` → `completed` (soft-fail returns are terminal).
> 3. **Gate:** before aggregating/deciding/reporting, `TaskList`; if any batch entry
>    is still `pending`/`in_progress`, do NOT advance — wait for the remaining
>    `<task-notification>`(s).
> 4. Escape hatch only: if, when next awake, a still-`in_progress` entry is judged
>    genuinely stuck, `TaskStop` its `dispatch_id`, mark it terminal, record a
>    soft-failure, proceed. Never `TaskOutput` a dispatch_id (transcript overflow).
>    Prose-count fallback (CRUD ledger tools genuinely absent): track the dispatched
>    count explicitly; do not advance until that many structured results are in hand.

### Per-skill placement

| Skill                 | Batch(es)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gate before                                                                                                                                         | Severity |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `fresh-pr`            | ci-watcher; pr-fixer (each sequential, per goal-loop iteration)                                                                                                                                                                                                                                                                                                                                                                                                                                               | pr-fixer dispatch; next-iteration dispatch                                                                                                          | medium   |
| `feature-development` | implementer; reviewer; fixer (wave-parallel per `skills/feature-development/CLAUDE.md`'s Parallelism analysis — Agent engine batches a wave's implementers, then its reviewers, then its fixers, each in one message; size-1 waves stay one at a time; merge-back runs via the orchestrator's own Bash, not a dispatch; the Workflow engine gates internally); review-phase finders then location-grouped verifiers (batched per the same file's Agent-engine fallback; the Workflow engine gates internally) | reviewer-batch dispatch; fixer-batch dispatch; that wave's merge-back; next-wave dispatch; the review verifier-batch dispatch; the review synthesis | medium   |

## Tests

See `test/coding-toolbox/CLAUDE.md` for the suite layout and coverage.
