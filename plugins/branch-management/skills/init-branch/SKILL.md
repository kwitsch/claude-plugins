---
name: init-branch
description: Use after creating or switching to a work branch to initialize its tooling context - refreshes the graphify knowledge-graph output and the context index for the current branch. Called by new-branch after branch creation; also user-invocable directly to refresh graph + index anytime.
argument-hint: "[--worktree-rebase <default-branch>]"
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

3. **Worktree self-rebase** — run ONLY when invoked with
   `--worktree-rebase <default>` in `$ARGUMENTS` (new-branch passes it on its
   linked-worktree path). Standalone invocations omit the flag and skip this
   step entirely — never rebase someone's in-progress branch unprompted.

   Inside a linked worktree new-branch cannot switch to the default branch to
   refresh the base, so this step does the equivalent in place: fetch the
   default branch and rebase the current branch onto it. **Synchronous, native
   Bash** (git writes — never the ctx sandbox, which discards them). Pass the
   `<default>` value from the flag as `$1`.

   ```bash
   #!/usr/bin/env bash
   # self-rebase the current worktree branch onto the refreshed default branch.
   # Synchronous native Bash (git writes). Always exits 0 — REBASE_RESULT carries
   # the outcome; a non-zero exit means a harness/dispatch error, not a git status.
   set -uo pipefail
   default="${1:-}"
   [ -n "$default" ] || { echo "REBASE_RESULT=failed"; echo "DETAIL=no default branch given"; exit 0; }
   root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "REBASE_RESULT=failed"; echo "DETAIL=not inside a git repository"; exit 0; }
   cd "$root" || { echo "REBASE_RESULT=failed"; echo "DETAIL=cannot cd to repo root"; exit 0; }
   # a rebase needs a clean tree — skip (never stash silently) if dirty
   if [ -n "$(git status --porcelain)" ]; then echo "REBASE_RESULT=skipped_dirty"; exit 0; fi
   if ! out="$(git fetch origin "$default" 2>&1)"; then
     echo "REBASE_RESULT=failed"; echo "DETAIL=fetch: $(printf '%s' "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; exit 0
   fi
   if git rebase "origin/$default" >/dev/null 2>&1; then
     echo "REBASE_RESULT=rebased"
   else
     git rebase --abort >/dev/null 2>&1 || true   # never leave a half-rebased tree
     echo "REBASE_RESULT=conflict"
   fi
   exit 0
   ```

   Outcome (read the `REBASE_RESULT=` line):
   - `rebased` → `self-rebased onto origin/<default>`
   - `skipped_dirty` → `rebase skipped: uncommitted changes`
   - `conflict` → `rebase aborted: conflicts with origin/<default> — resolve manually`
   - `failed` → `rebase failed` + `DETAIL`

4. **graphify update** — skip if probe printed `GRAPHIFY=no` OR
   `graphify_branch_update` is literally `false`.

   Run via `Bash(run_in_background: true)` — graphify writes `graphify-out/`;
   always native Bash (ctx sandbox discards filesystem writes). Append
   `--force` when `${user_config.graphify_force_create}` is literally `true`;
   append `--keep-user-files` when `${user_config.graphify_user_files}` is
   literally `true`.

   The script **always exits 0**; its outcome is carried on the
   `GRAPHIFY_RESULT=` line it prints (a background script that exits non-zero is
   reported by the harness as a failed command, so status must NOT ride the exit
   code — read the line instead).

   ```bash
   #!/usr/bin/env bash
   # Always exits 0; the GRAPHIFY_RESULT=<status> line below carries the outcome.
   set -uo pipefail
   force=0; keep_user_files=0
   while [ $# -gt 0 ]; do
     case "$1" in
       --force) force=1 ;;
       --keep-user-files) keep_user_files=1 ;;
       *) echo "GRAPHIFY_RESULT=failed"; echo "DETAIL=usage: [--force] [--keep-user-files]"; exit 0 ;;
     esac; shift
   done
   root=$(git rev-parse --show-toplevel 2>/dev/null) || {
     echo "GRAPHIFY_RESULT=failed"; echo "DETAIL=not inside a git repository"; exit 0
   }
   cd "$root" || { echo "GRAPHIFY_RESULT=failed"; echo "DETAIL=cannot cd to repo root"; exit 0; }
   command -v graphify >/dev/null 2>&1 || { echo "GRAPHIFY_RESULT=unavailable"; exit 0; }
   if [ ! -d graphify-out ]; then
     if [ "$force" -eq 1 ]; then mkdir -p graphify-out; else echo "GRAPHIFY_RESULT=no_folder"; exit 0; fi
   fi
   if ! out="$(timeout -k 10 "${GRAPHIFY_TIMEOUT:-600}" graphify update . 2>&1)"; then
     echo "GRAPHIFY_RESULT=failed"; echo "DETAIL=$(printf '%s' "$out" | tail -3 | tr '\n' ' ' | cut -c1-300)"; exit 0
   fi
   [ "$keep_user_files" -eq 0 ] && rm -f graphify-out/graph.html
   echo "GRAPHIFY_RESULT=updated"
   exit 0
   ```

   Status mapping (read the `GRAPHIFY_RESULT=` line, NOT the exit code):
   - `updated` → graphify status `updated` — files left uncommitted
   - `unavailable` → `skipped: graphify unavailable`
   - `no_folder` → `skipped: no graphify-out folder`
   - `failed` → `failed` — include the `DETAIL` excerpt
   - no `GRAPHIFY_RESULT=` line at all (e.g. the background script was killed
     before printing) → treat as `failed` (soft-fail, never block).

   Never commit in init-branch — `graphify-out` changes stay uncommitted on
   the branch; they will trip the clean-tree guard on the next `new-branch`
   run (commit or stash first). When `graphify-out` is gitignored (e.g.
   "local development only, never pushed"), the changes stay local and never
   appear in `git status`, so they neither commit nor trip the guard.

5. **ctx_index** — skip if `context_index` is literally `false`.

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

6. **Wait** — if step 4 dispatched a background Bash, do NOT advance to step 7
   until the background Bash notification arrives and its `GRAPHIFY_RESULT=` line
   is mapped to a status string. If step 4 was skipped, proceed immediately.
   (Step 3, when it ran, is synchronous — already done before this point.)

7. **Report** these structured outcome lines (the caller — new-branch —
   includes them verbatim under the branch name it reports):
   - rebase (only when step 3 ran): `self-rebased onto origin/<default>` /
     `rebase skipped: uncommitted changes` /
     `rebase aborted: conflicts with origin/<default> — resolve manually` /
     `rebase failed + detail`. Omit this line entirely when step 3 was skipped.
   - graphify: `updated — files left uncommitted` /
     `skipped: graphify unavailable` /
     `skipped: no graphify-out folder` /
     `failed + detail` /
     `disabled via settings`.
   - ctx-index: `indexed` /
     `skipped: ctx_index unavailable` /
     `failed + detail` /
     `disabled via settings`.
