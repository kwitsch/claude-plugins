---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then dispatches graphify-agent and ctx-index-agent in parallel (graphify_branch_update / graphify_force_create / graphify_user_files and context_index options).
argument-hint: "[branch-name | task description]"
allowed-tools: ["Agent", "Bash(git:*)", "Bash(echo:*)"]
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

3. **Resolve paths** (run both in one message via Bash before dispatching):
   - Plugin root: `echo "${CLAUDE_PLUGIN_ROOT}"`
   - Repository root: `git rev-parse --show-toplevel`

4. **Parallel graphify + ctx-index update.**

   Check toggles:
   - `graphify_branch_update`: `${user_config.graphify_branch_update}` —
     ONLY literal `false` disables (fail-open). Disabled → skip graphify.
   - `context_index`: `${user_config.context_index}` —
     ONLY literal `false` disables (fail-open). Disabled → skip ctx-index.

   Dispatch ALL enabled agents in ONE message (parallel, Agent tool):

   - `branch-management:graphify-agent` (when graphify enabled) — prompt
     contains: absolute path `<plugin-root>/bin/graphify-update.sh`;
     `commit: no` (always for new-branch);
     `force: yes` only when `${user_config.graphify_force_create}` is
     literally `true`, otherwise `force: no` (FAIL-CLOSED);
     `user_files: yes` only when `${user_config.graphify_user_files}` is
     literally `true`, otherwise `user_files: no` (FAIL-CLOSED).
   - `branch-management:ctx-index-agent` (when ctx-index enabled) — prompt
     contains: the resolved repository root path.

   If both are disabled, skip this step entirely.

   Soft-fail: every agent status only feeds the report — never abort.
   When graphify status is `updated`, note that `graphify-out` files are
   left uncommitted on the fresh branch; they will trip the clean-tree
   guard on the next `new-branch` run (commit or stash them first).

5. **Report:** new branch name and commit it was cut from, straight from
   agent's result; graphify outcome (updated — files left uncommitted /
   skipped: no CLI / skipped: no graphify-out folder / failed + detail /
   disabled via settings); ctx-index outcome (indexed / skipped / failed +
   detail / disabled via settings).
