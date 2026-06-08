---
name: graphify-update
description: Refresh the graphify knowledge-graph output for the current repository. Pass --commit to commit the result as a separate chore commit. Called by new-branch (no commit) and new-pr (--commit); also user-invocable directly.
argument-hint: "[--commit] [--force] [--user-files]"
context: fork
model: haiku
effort: low
disable-model-invocation: true
allowed-tools: ["Agent"]
---

Refresh the graphify output for the current repository.

## Argument resolution

Parse `$ARGUMENTS` word by word:
- `--commit` present → `commit: yes`; absent → `commit: no`.
  **Never fall back to a toggle for `--commit`** — commit is always
  caller-explicit. new-branch never passes it; new-pr always does.
- `--force` present → `force: yes`; absent → read
  `${user_config.graphify_force_create}`: ONLY the literal value `true`
  → `force: yes`; anything else (including empty or uninterpolated
  placeholder) → `force: no`.
- `--user-files` present → `user_files: yes`; absent → read
  `${user_config.graphify_user_files}`: ONLY the literal value `true`
  → `user_files: yes`; anything else → `user_files: no`.

## Steps

1. Resolve `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path:
   run `echo "${CLAUDE_PLUGIN_ROOT}"` via the Agent tool's Bash
   capability or note it if already known from the dispatch prompt.

2. Dispatch `branch-management:graphify-agent` (Agent tool) with a
   prompt that contains:
   - Absolute path: `<plugin-root>/scripts/graphify-update.sh`
   - `commit: <yes|no>` as resolved above
   - `force: <yes|no>` as resolved above
   - `user_files: <yes|no>` as resolved above

3. Your final message is the agent result verbatim:
   `status: <updated|skipped_no_cli|skipped_no_dir|failed>`
   `committed: <true|false>`
   (optional) `detail: <one line>`

Soft-fail: every status value is valid — never abort.
