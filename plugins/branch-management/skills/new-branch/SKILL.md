---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then refreshes the context-mode index when that plugin is installed.
---

# Start a new work branch

Thin orchestrator: the git mechanics run in the dedicated `branch-agent`
subagent (haiku); this skill only dispatches, handles user decisions and
reports. Do not run the git steps yourself.

## Steps

1. **Dispatch the branch-agent** (Agent tool, subagent type
   `branch-management:branch-agent`). The dispatch prompt contains exactly
   one of:
   - the explicit branch name or description the user passed as argument, or
   - the task context from the conversation to derive a name from.
   If there is no argument and no task context to derive from, ask the user
   first.

2. **Handle a structured abort** from the agent:
   - `dirty_tree` — ask the user: commit, stash, or abort? Execute the choice
     (commit/stash in the main context), then re-dispatch the agent.
   - `name_exists` — the tree is already on the default branch at this point;
     mention that. Ask the user: switch to the existing branch (local:
     `git checkout <branch>`; remote-only: `git checkout <branch>` creates a
     tracking branch automatically) or pick a different name (then
     re-dispatch).
   - `no_remote` / `pull_failed` — report the detail and stop; never branch
     off a stale or unknown base. After `pull_failed` the working tree is
     already on the default branch — say so in the report, so the user knows
     their starting branch changed.

3. **context-mode indexing (only if installed).** If the context-mode plugin
   is available in this session (its `context-mode:ctx-index` skill appears
   in the skill list), invoke that skill for the repository root so the
   knowledge base reflects the new branch state. This stays in the main
   context because the index serves the main session. If the plugin is not
   installed, skip silently — its absence is not an error.

4. **Report:** the new branch name and the commit it was cut from, straight
   from the agent's result.
