---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then invokes the init-branch skill to refresh the graphify output and context-mode index (graphify_branch_update / graphify_force_create / graphify_user_files and context_index options).
argument-hint: "[branch-name | task description]"
allowed-tools: ["Agent", "Skill", "Bash(git:*)", "Bash(echo:*)", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# Start a new work branch

Thin orchestrator: git mechanics run in dedicated `branch-agent` subagent
(haiku); this skill only dispatch, handle user decisions, report. No run git
steps yourself.

## Steps

1. **Dispatch branch-agent** (Agent tool, subagent type
   `branch-management:branch-agent`). Dispatch prompt holds exactly one of:
   - explicit branch name or description user passed as argument, or
   - task context from conversation to derive name from.
   No argument and no task context to derive from → ask user first.

   **Gate on completion before any subsequent work.** branch-agent runs
   `git checkout -b <branch>` in the shared working tree. Do NOT start
   file edits or git operations until the agent completion notification
   arrives. Reads of branch-invariant content (e.g. scanning for files
   to audit) may overlap; any write to a file or git operation MUST wait
   — otherwise changes land on the wrong branch.

   **Subagent reconciliation gate.** Formalize the gate above with the ledger so the
   branch-agent finish is never missed. Load the ledger tools once (deferred; resolve
   at depth 0, where this skill runs — a subagent-scoped probe falsely reports these
   absent, do NOT skip the ledger on that basis):
   `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
   (retry bare names). Only if nothing loads, use the prose-count fallback below.
   1. On dispatch, `TaskCreate` one entry (`subject` = `branch-agent`,
      `metadata.dispatch_id` = its Agent `task_id`), then `TaskUpdate` → `in_progress`.
   2. On the `<task-notification>`, match by `dispatch_id`, record the structured
      result (success, or an abort code), `TaskUpdate` → `completed` (an abort code
      is terminal too).
   3. **Gate:** do NOT handle aborts (step 2), invoke init-branch (step 3), or do any
      file edit / git operation until `TaskList` shows the branch-agent entry
      terminal.
   4. Escape hatch only: if, when next awake, the entry is judged genuinely stuck,
      `TaskStop` its `dispatch_id`, mark it terminal, report the stall, and stop
      (never branch off an unknown base). Never `TaskOutput` a dispatch_id
      (transcript overflow).
   Prose-count fallback (tools genuinely absent): do not advance until the
   branch-agent's structured result is in hand. See `.claude/rules/subagent-tracking.md`.

2. **Handle structured abort** from agent:
   - `dirty_tree` — ask user: commit, stash, or abort? Execute choice
     (commit/stash in main context), then re-dispatch agent.
   - `name_exists` — tree already on default branch now; mention that. Ask
     user: switch to existing branch (local: `git checkout <branch>`;
     remote-only: `git checkout <branch>` creates tracking branch
     automatically) or pick different name (then re-dispatch).
   - `no_remote` / `pull_failed` — report detail, stop; never branch off
     stale or unknown base. After `pull_failed` working tree already on
     default branch — say so in report, so user know starting branch changed.

3. **Initialize branch tooling.** Invoke the `branch-management:init-branch`
   skill (Skill tool) with no arguments. It resolves the plugin root, repo
   root and all graphify/context-mode toggles itself, runs background Bash
   for graphify refresh (toggled by `graphify_branch_update`) + makes a
   direct ctx_index MCP call (toggled by `context_index`), and returns
   structured graphify + ctx-index outcome lines. (Skipped silently if both
   its toggles are off — it reports that.)

4. **Report:** new branch name and the commit it was cut from (straight from
   the branch-agent result), then include the init-branch skill's graphify +
   ctx-index outcome lines verbatim.
