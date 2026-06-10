---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then invokes the init-branch skill to refresh the graphify output and context-mode index (graphify_branch_update / graphify_force_create / graphify_user_files and context_index options).
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

3. **Initialize branch tooling.** Invoke the `branch-management:init-branch`
   skill (Skill tool) with no arguments. It resolves the plugin root, repo
   root and all graphify/context-mode toggles itself, dispatches
   `graphify-agent` + `ctx-index-agent` in parallel, and returns structured
   graphify + ctx-index outcome lines. (Skipped silently if both its toggles
   are off — it reports that.)

4. **Report:** new branch name and the commit it was cut from (straight from
   the branch-agent result), then include the init-branch skill's graphify +
   ctx-index outcome lines verbatim.
