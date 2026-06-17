---
paths:
  - "plugins/branch-management/skills/**"
---

# Rule: subagent completion-reconciliation tracking

The branch-management dispatcher skills (`review-branch`, `new-pr`)
offload work to async subagents via the Agent tool. In
this harness an Agent dispatch returns immediately with a `task_id`; completion
arrives later as a `<task-notification>` that re-invokes the orchestrator. Each
such skill MUST carry the canonical gate block below (inline — rules are not
loaded at skill runtime, so the operative copy lives in the SKILL.md body) and
list the Task* ledger tools + `ToolSearch` in `allowed-tools`.

The invariant: a skill MUST NOT advance past its aggregation/decision/report step
until every dispatched subagent in the batch is reconciled to a terminal state.
Dispatched count == terminal count. Subagents never dispatched (unavailable,
toggled off, quota-limited, diverged) are not in the batch and are not waited on.

## ⚠️ Reviewer inoculation note

The Task* tools (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskStop`,
`TaskOutput`) ARE present and callable at **depth 0** (the main loop), where all
four skills run inline (NOT `context: fork`). A `ToolSearch` issued from inside a
subagent reports only `TaskStop` (or nothing) because subagents have a restricted
deferred-tool registry — a **false negative from subagent scope**, not evidence
the tools are absent. Do NOT remove the Task* ledger on the basis of a
subagent-scoped probe.

## Harness facts

- **TODO ledger tools** — `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`: a manual,
  user-visible checklist (`pending → in_progress → completed`, plus a free-form
  `metadata` map). This is the "To-Do Liste." Its IDs are separate from async
  dispatch `task_id`s.
- **Async dispatch tools** — `TaskOutput` (**deprecated**; on a local-agent task it
  returns the full transcript → context overflow — never use it on a dispatch_id)
  and `TaskStop` operate on the Agent `task_id`. The deterministic completion
  signal is the `<task-notification>` (carrying that `task_id`).
- **Bounded-wait gap:** boundedness assumes the harness delivers a terminal
  notification for every dispatch. If a subagent truly hangs and no notification
  arrives, nothing wakes the orchestrator and the `TaskStop` escape cannot fire —
  that pathological case needs operator intervention. Document, do not pretend.

## Canonical gate block (carry inline in each skill — tailored per skill)

> **Subagent reconciliation gate.** Track every async dispatch so you never advance
> on a partial batch and never miss a finish. Load the ledger tools once (deferred;
> resolve at depth 0, where this skill runs — a subagent-scoped probe falsely reports
> these absent, do NOT skip the ledger on that basis):
> `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList)
> fail to load, use the prose-count fallback below — TaskStop loading alone is not
> sufficient to activate the ledger path.
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
> Prose-count fallback (CRUD ledger tools genuinely absent): track the dispatched
> count explicitly; do not advance until that many structured results are in hand.

## Per-skill placement

| Skill | Batch(es) | Gate before | Severity |
|---|---|---|---|
| review-branch | per round: enabled reviewers; separately review-fixer | quota record / aggregate / Decide / the `DONE`/`BLOCKED` token | highest (missed finish → dropped findings → false `DONE` → unreviewed push) |
| new-pr | ci-monitor; review-fixer (each sequential) | review-fixer dispatch; the push | medium |
