---
name: init-branch
description: Use after creating or switching to a work branch to initialize its tooling context - refreshes the graphify knowledge-graph output and the context index for the current branch. Called by new-branch after branch creation; also user-invocable directly to refresh graph + index anytime.
allowed-tools: ["Bash(git:*)", "Bash(echo:*)", "Bash(bash:*)", "ToolSearch", "mcp__plugin_cave-context_cave-context__*", "mcp__plugin_context-mode_context-mode__*", "mcp__context-mode__*"]
---

# Initialize branch tooling context

Refreshes graphify output + context index for the current branch inline —
no subagents. Background Bash handles graphify; a direct ctx_index MCP call
handles indexing.

## Availability (dynamic-context injection)

```!
command -v graphify >/dev/null 2>&1 && echo "GRAPHIFY=yes" || echo "GRAPHIFY=no"
```

## Steps

1. **Resolve repository root:**
   `git rev-parse --show-toplevel`

2. **Check toggles** (interpolated `${user_config.*}`):
   - `graphify_branch_update`: `${user_config.graphify_branch_update}` —
     ONLY literal `false` disables (fail-open). Disabled → skip graphify.
   - `context_index`: `${user_config.context_index}` —
     ONLY literal `false` disables (fail-open). Disabled → skip ctx-index.

3. **graphify update** — skip if probe printed `GRAPHIFY=no` OR
   `graphify_branch_update` is literally `false`.

   Run via `Bash(run_in_background: true)` — graphify writes `graphify-out/`;
   always native Bash (ctx sandbox discards filesystem writes). Append
   `--force` when `${user_config.graphify_force_create}` is literally `true`;
   append `--keep-user-files` when `${user_config.graphify_user_files}` is
   literally `true`.

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   force=0; keep_user_files=0
   while [ $# -gt 0 ]; do
     case "$1" in
       --force) force=1 ;;
       --keep-user-files) keep_user_files=1 ;;
       *) echo "usage: [--force] [--keep-user-files]" >&2; exit 1 ;;
     esac; shift
   done
   root=$(git rev-parse --show-toplevel 2>/dev/null) || {
     echo "not inside a git repository" >&2; exit 1
   }
   cd "$root"
   command -v graphify >/dev/null 2>&1 || exit 2
   if [ ! -d graphify-out ]; then
     [ "$force" -eq 1 ] || exit 5
     mkdir -p graphify-out
   fi
   timeout -k 10 "${GRAPHIFY_TIMEOUT:-600}" graphify update . || exit 4
   if [ "$keep_user_files" -eq 0 ]; then rm -f graphify-out/graph.html; fi
   ```

   Exit-code mapping (read from the notification):
   - `0` → graphify status `updated` — files left uncommitted
   - `2` → `skipped: graphify unavailable`
   - `5` → `skipped: no graphify-out folder`
   - other → `failed` — include short stderr excerpt as `detail`

   Never commit in init-branch — `graphify-out` changes stay uncommitted on
   the branch; they will trip the clean-tree guard on the next `new-branch`
   run (commit or stash first).

4. **ctx_index** — skip if `context_index` is literally `false`.

   Probe in order, stop at first match:
   1. `ToolSearch(query: "select:mcp__plugin_cave-context_cave-context__ctx_index")`
   2. If nothing: `ToolSearch(query: "select:mcp__plugin_context-mode_context-mode__ctx_index")`
   3. If nothing: `ToolSearch(query: "select:ctx_index")` (bare fallback)

   Tool found → call it directly:
   - `path`: repository root from step 1
   - `source`: `"project:<basename>"` where `<basename>` is the last path
     component of the root (e.g. `/home/user/repos/my-app` → `"project:my-app"`)
   - `maxDepth`: `5`
   - `maxFiles`: `200`

   Tool not found after all three probes → ctx-index status
   `skipped: ctx_index unavailable`.

   Soft-fail: a failed call feeds the report only — never abort.

5. **Wait** — if step 3 dispatched a background Bash, do NOT advance to step 6
   until the background Bash notification arrives and the exit code is mapped to
   a status string. If step 3 was skipped, proceed immediately.

6. **Report** these structured outcome lines (the caller — new-branch —
   includes them verbatim under the branch name it reports):
   - graphify: `updated — files left uncommitted` /
     `skipped: graphify unavailable` /
     `skipped: no graphify-out folder` /
     `failed + detail` /
     `disabled via settings`.
   - ctx-index: `indexed` /
     `skipped: ctx_index unavailable` /
     `failed + detail` /
     `disabled via settings`.
