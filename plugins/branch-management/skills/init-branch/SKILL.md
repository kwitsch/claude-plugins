---
name: init-branch
description: Use after creating or switching to a work branch to initialize its tooling context - refreshes the graphify knowledge-graph output and the context-mode index for the current branch. Called by new-branch after branch creation; also user-invocable directly to refresh graph + index anytime.
allowed-tools: ["Agent", "Bash(git:*)", "Bash(echo:*)", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# Initialize branch tooling context

Thin orchestrator: refreshes graphify output + context-mode index for the
current branch by dispatching two dedicated agents in parallel. Runs INLINE
(NOT `context: fork`) — a forked skill is a subagent and subagents have no
Agent tool, so it must stay at depth 0 to dispatch the agents below.

## Availability (dynamic-context injection)

```!
command -v graphify >/dev/null 2>&1 && echo "GRAPHIFY=yes" || echo "GRAPHIFY=no"
```

For context-mode, resolve the index tool deterministically:
`ToolSearch(query: "select:mcp__plugin_context-mode_context-mode__ctx_index")`
(retry bare `select:ctx_index`). The tool is available iff a schema loads — do NOT
infer availability from your own tool list.

## Steps

1. **Resolve paths** (run both in one message via Bash):
   - Plugin root: `echo "${CLAUDE_PLUGIN_ROOT}"`
   - Repository root: `git rev-parse --show-toplevel`

2. **Check toggles** (interpolated `${user_config.*}`):
   - `graphify_branch_update`: `${user_config.graphify_branch_update}` —
     ONLY literal `false` disables (fail-open). Disabled → skip graphify.
   - `context_index`: `${user_config.context_index}` —
     ONLY literal `false` disables (fail-open). Disabled → skip ctx-index.

3. **Dispatch each available + enabled agent in ONE message** (parallel,
   Agent tool). Dispatch is gated on availability (from the probes above)
   AND toggle — never on your own tool list:

   - `branch-management:graphify-agent` — dispatch ONLY when the probe
     printed `GRAPHIFY=yes` AND `${user_config.graphify_branch_update}` is
     not literally `false`. Prompt contains:
     `commit: no` (always);
     `force: yes` only when `${user_config.graphify_force_create}` is
     literally `true`, otherwise `force: no` (FAIL-CLOSED);
     `user_files: yes` only when `${user_config.graphify_user_files}` is
     literally `true`, otherwise `user_files: no` (FAIL-CLOSED).
   - `branch-management:ctx-index-agent` — dispatch ONLY when the
     `ctx_index` ToolSearch resolve succeeded (a schema loaded) AND
     `${user_config.context_index}` is not literally `false`. Prompt
     contains: the resolved repository root path.

   If neither is available + enabled, skip this step entirely and say so
   in the report.

   Soft-fail: every dispatched agent's status only feeds the report —
   never abort. When graphify status is `updated`, note that `graphify-out`
   files are left uncommitted on the current branch; they will trip the
   clean-tree guard on the next `new-branch` run (commit or stash first).

4. **Reconcile dispatch before reporting (subagent gate).**

   **Subagent reconciliation gate.** Track every async dispatch so you never advance
   on a partial batch and never miss a finish. Load the ledger tools once (deferred;
   resolve at depth 0, where this skill runs — a subagent-scoped probe falsely reports
   these absent, do NOT skip the ledger on that basis):
   `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
   (retry bare names). Only if nothing loads, use the prose-count fallback below.
   1. On dispatch (step 3), `TaskCreate` one entry per agent actually dispatched
      (`subject` = `graphify-agent` / `ctx-index-agent`, `metadata.dispatch_id` =
      its Agent `task_id`), then `TaskUpdate` it to `in_progress`. If neither agent
      was dispatched, the batch is empty — skip the rest of this step.
   2. On each `<task-notification>`, match by `dispatch_id`, record the agent's
      outcome string, `TaskUpdate` → `completed` (a failed/`disabled` outcome is
      terminal too — soft-fail, never abort).
   3. **Gate:** before assembling the report (next step), `TaskList`; if any batch
      entry is still `pending`/`in_progress`, do NOT advance — wait for the remaining
      `<task-notification>`(s).
   4. Escape hatch only: if, when next awake, a still-`in_progress` entry is judged
      genuinely stuck, `TaskStop` its `dispatch_id`, mark it terminal
      (`metadata.outcome: "stopped"`), record it as a `failed` outcome, and proceed.
      Never `TaskOutput` a dispatch_id (transcript overflow).
   Prose-count fallback (tools genuinely absent): track the dispatched count
   explicitly; do not assemble the report until that many outcomes are in hand.
   See `.claude/rules/subagent-tracking.md`.

5. **Report** these structured outcome lines (the caller — new-branch —
   includes them verbatim under the branch name it reports):
   - graphify outcome: `updated — files left uncommitted` /
     `skipped: graphify unavailable` (probe printed `GRAPHIFY=no`) /
     `skipped: no graphify-out folder` / `failed + detail` /
     `disabled via settings`.
   - ctx-index outcome: `indexed` /
     `skipped: context-mode unavailable` (ctx_index did not resolve) /
     `failed + detail` / `disabled via settings`.
