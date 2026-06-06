---
name: new-branch
description: Use when starting new feature, fix, or chore work that needs its own branch - dispatches the branch-agent subagent to switch to the default branch, pull the latest state and create a new work branch, then refreshes the context-mode index (declared plugin dependency, togglable via the context_index option).
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

3. **context-mode indexing.** Gated by the `context_index` toggle —
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

4. **Report:** new branch name and commit it was cut from, straight from
   agent's result.
