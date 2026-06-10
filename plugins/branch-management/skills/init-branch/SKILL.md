---
name: init-branch
description: Use after creating or switching to a work branch to initialize its tooling context - refreshes the graphify knowledge-graph output and the context-mode index for the current branch. Called by new-branch after branch creation; also user-invocable directly to refresh graph + index anytime.
allowed-tools: ["Agent", "Bash(git:*)", "Bash(echo:*)"]
---

# Initialize branch tooling context

Thin orchestrator: refreshes graphify output + context-mode index for the
current branch by dispatching two dedicated agents in parallel. Runs INLINE
(NOT `context: fork`) — a forked skill is a subagent and subagents have no
Agent tool, so it must stay at depth 0 to dispatch the agents below.

## Steps

1. **Resolve paths** (run both in one message via Bash):
   - Plugin root: `echo "${CLAUDE_PLUGIN_ROOT}"`
   - Repository root: `git rev-parse --show-toplevel`

2. **Check toggles** (interpolated `${user_config.*}`):
   - `graphify_branch_update`: `${user_config.graphify_branch_update}` —
     ONLY literal `false` disables (fail-open). Disabled → skip graphify.
   - `context_index`: `${user_config.context_index}` —
     ONLY literal `false` disables (fail-open). Disabled → skip ctx-index.

3. **Dispatch ALL enabled agents in ONE message** (parallel, Agent tool):

   - `branch-management:graphify-agent` (when graphify enabled) — prompt
     contains: absolute path `<plugin-root>/bin/graphify-update.sh`;
     `commit: no` (always);
     `force: yes` only when `${user_config.graphify_force_create}` is
     literally `true`, otherwise `force: no` (FAIL-CLOSED);
     `user_files: yes` only when `${user_config.graphify_user_files}` is
     literally `true`, otherwise `user_files: no` (FAIL-CLOSED).
   - `branch-management:ctx-index-agent` (when ctx-index enabled) — prompt
     contains: the resolved repository root path.

   If both are disabled, skip this step entirely.

   Soft-fail: every agent status only feeds the report — never abort.
   When graphify status is `updated`, note that `graphify-out` files are
   left uncommitted on the current branch; they will trip the clean-tree
   guard on the next `new-branch` run (commit or stash them first).

4. **Report** these structured outcome lines (the caller — new-branch —
   includes them verbatim under the branch name it reports):
   - graphify outcome: `updated — files left uncommitted` / `skipped: no CLI` /
     `skipped: no graphify-out folder` / `failed + detail` /
     `disabled via settings`.
   - ctx-index outcome: `indexed` / `skipped` / `failed + detail` /
     `disabled via settings`.
