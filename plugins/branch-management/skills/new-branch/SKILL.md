---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then optionally refreshes the graphify output (graphify_branch_update / graphify_force_create options) and the context-mode index (declared plugin dependency, togglable via the context_index option).
argument-hint: "[branch-name | task description]"
allowed-tools: ["Agent", "Skill", "Bash(git:*)", "Bash(echo:*)"]
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

3. **graphify update.** Gated by the `graphify_branch_update` toggle —
   current value: `${user_config.graphify_branch_update}`. ONLY the
   literal value `false` disables (fail-open: `true`, empty, or an
   uninterpolated placeholder all mean enabled).
   - Disabled → skip this step; report mentions
     `graphify disabled via settings`.
   - Enabled → resolve `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute
     path first (e.g. `echo "${CLAUDE_PLUGIN_ROOT}"`), then dispatch
     `branch-management:graphify-agent` (Agent tool) with: the absolute
     path of `<plugin-root>/scripts/graphify-update.sh`, `commit: no`,
     and `force` from the `graphify_force_create` toggle — current
     value: `${user_config.graphify_force_create}`. This toggle is
     FAIL-CLOSED, inverted from every other toggle: ONLY the literal
     value `true` means `force: yes`; `false`, empty, or an
     uninterpolated placeholder all mean `force: no` — a placeholder
     must never create a folder.
   - Soft-fail: every agent status (`updated`, `skipped_no_cli`,
     `skipped_no_dir`, `failed`) only feeds the report — never abort
     the skill. Updated files stay uncommitted on the fresh branch;
     mention that in the report when the agent reports `updated` —
     and note that this dirty `graphify-out` will trip the
     clean-tree guard on the next new-branch run (commit or stash
     it first).

4. **context-mode indexing.** Gated by the `context_index` toggle —
   current value: `${user_config.context_index}`. ONLY the literal value
   `false` disables (fail-open: `true`, empty, or an uninterpolated
   placeholder all mean enabled).
   - Disabled → skip this step; report mentions
     `indexing disabled via settings`.
   - Enabled → context-mode declared dependency of this plugin — invoke
     its `context-mode:ctx-index` skill for repository root so knowledge
     base reflects new branch state. Stays in main context because index
     serves main session. Skill missing from session → dependency broken
     or disabled — mention that in report (point at `claude plugin list`
     / `context-mode:ctx-doctor`), continue without indexing.

5. **Report:** new branch name and commit it was cut from, straight from
   agent's result; plus the graphify outcome (updated — files left
   uncommitted / skipped: no CLI / skipped: no graphify-out folder /
   failed + detail / disabled via settings).
