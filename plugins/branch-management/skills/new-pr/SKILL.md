---
name: new-pr
description: Use when branch work complete and should become pull/merge request - runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer subagents, configurable max rounds) with verified fixes between rounds, pushes, opens PR or MR via gh or glab, then watches CI and CodeRabbit feedback until all green. Optionally refreshes and separately commits the graphify output before pushing. Review sources can be disabled per user or per project.
argument-hint: "[--base <branch>]"
allowed-tools: ["Agent", "Skill", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)", "Bash(echo:*)", "Bash(bash:*)", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# Turn the current branch into a reviewed PR/MR

Thin orchestrator: reviews run in dedicated read-only reviewer subagents
(`claude-reviewer` on opus, three CLI reviewers on haiku), all fixes
run in `review-fixer` subagent (opus), CI watch runs in
`ci-monitor` subagent (sonnet). Skill handles preconditions,
dispatching review rounds, aggregation + dedupe, fix loop, submission
and monitor loop — raw review output and CI logs never enter main
context: subagents keep heavy output out of context via context-mode
when it is installed, falling back to native tools otherwise. Review
sources, CI monitoring and CodeRabbit comment handling
are individually togglable via the plugin's `userConfig` options,
read in preconditions (step 4).

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; wt=no; [ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ] && wt=yes; printf "current_branch: %s\ndetected_base: %s\nlinked_worktree: %s\n" "$(git branch --show-current)" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')" "$wt"`

## Preconditions

1. **Assert a named branch:** from the git context above, extract the
   value on the `current_branch:` line and assign it to `$branch`. If
   empty (detached HEAD), abort and tell user to check out a branch first.
   Also note the `linked_worktree:` value (`yes`/`no`) — it governs the push in
   step 11.

   **Session-PR linkage (bridge / remote sessions).** When `linked_worktree:` is
   `yes` the current branch is the session branch the remote tracks
   (`worktree-bridge-cse_<id>`), and the bridge links a PR as the *session PR*
   only when the PR head ref **is** that branch. So this skill opens the PR from
   `$branch` as-is — it never renames the branch or pushes under a different
   name. (new-branch already preserves the session branch in a worktree; if you
   reach here on a manually-created non-session branch, the PR will still open
   but may not register as the session PR — say so in the report.)

2. **Resolve base branch.** Check `$ARGUMENTS` for `--base <branch>`;
   if present, use that value as `$base`. Otherwise extract the value on
   the `detected_base:` line from the git context above. If still empty,
   ask the user for the base branch.

   Once `$base` is known, refresh the local base ref — the CodeRabbit CLI
   resolves `--base` against the local branch, not the remote-tracking ref:

   ```bash
   git fetch origin "$base:$base" 2>/dev/null || true
   ```

   (The refspec update is refused when `$base` is checked out — that case
   aborts in step 3 anyway.) Everywhere below, git revisions use
   `origin/$base` — only the PR/MR creation takes the bare name.

3. **Abort with a clear message if:**
   - the current branch *is* the base branch (nothing to open a PR from), or
   - `git log "origin/$base"..HEAD --oneline` is empty and
     `git status --porcelain` is also empty (no work to submit).

4. **Read graphify and CI toggles.** The plugin declares them via
   `userConfig` in plugin.json; Claude Code stores the values in
   settings.json under `pluginConfigs["branch-management"].options`
   (native scope precedence: local > project > user) and interpolates
   them directly into this skill:

   | Toggle | Value |
   |---|---|
   | ci_monitor | `${user_config.ci_monitor}` |
   | ci_watch_timeout | `${user_config.ci_watch_timeout}` |
   | coderabbit_ci_comments | `${user_config.coderabbit_ci_comments}` |
   | graphify_pr_update | `${user_config.graphify_pr_update}` |
   | graphify_pr_commit | `${user_config.graphify_pr_commit}` |

   Evaluation rule (fail-open): ONLY the literal value `false` disables
   a toggle. Anything else — `true`, an empty value, or an
   uninterpolated `${user_config.…}` placeholder on an older Claude
   Code version — counts as enabled. `ci_watch_timeout` is numeric:
   use the literal value only when it is a positive whole-number value;
   otherwise fall back to `1800`. `ci_monitor` gates the whole monitor
   loop (steps 13–15), while `coderabbit_ci_comments` only suppresses
   CodeRabbit comment collection within step 13. `graphify_pr_update`
   gates the graphify refresh in the Submit stage (step 9) and
   `graphify_pr_commit` its separate commit.

   Review toggles (`review_claude/codex/copilot/coderabbit`),
   `review_max_rounds`, and reviewer quota checks are handled
   autonomously by the `review-branch` sub-skill (step 6).

## Subagent dispatch tracking

**Subagent reconciliation gate.** This skill dispatches subagents sequentially
(ci-monitor and review-fixer in the monitor loop). Track
each so a result is never consumed before its dispatch is terminal. Load the ledger
tools once (deferred; resolve at depth 0, where this skill runs — a subagent-scoped
probe falsely reports these absent, do NOT skip the ledger on that basis):
`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
(retry bare names). Only if nothing loads, use the prose-count fallback.
For every Agent dispatch below: `TaskCreate` an entry (`metadata.dispatch_id` =
the Agent `task_id`, `in_progress`); on its `<task-notification>` record the
structured result and `TaskUpdate` → `completed`; and at the named gate point, do
NOT advance until `TaskList` shows that entry terminal. Stuck entry when next awake
→ `TaskStop` + soft-fail. Never `TaskOutput` a dispatch_id (transcript overflow).
Prose-count fallback (tools genuinely absent): hold each step until the dispatched
subagent's structured result is in hand. (review-branch in step 6 is a Skill
invocation, not an Agent dispatch — it runs its own internal gate, not tracked here.)
See `.claude/rules/subagent-tracking.md`.

## Review rounds

5. **Commit pending work.** This is mandatory: codex and copilot diff
   committed state against `origin/$base`, and coderabbit diffs against
   the local `$base`. Uncommitted work-tree edits are invisible to
   reviewers. Commit only changes that belong to this branch's work; if
   unclear whether a change belongs, ask the user.

6. **Run review rounds.** Invoke the `branch-management:review-branch`
   skill (Skill tool) with: `--base "$base"`. The sub-skill reads its
   own `review_max_rounds`, `review_claude`/`review_codex`/
   `review_copilot`/`review_coderabbit` toggles, and performs quota
   checks autonomously. It also handles the base-divergence check for
   coderabbit (performed independently from step 2).

   `review-branch`'s report leads with a terminal-state token — `DONE`
   or `BLOCKED` as the first token of its first line. If that token is
   `BLOCKED` (round cap reached with open findings, or no review source
   succeeded), do not proceed to Submit — surface the findings and any
   unpushed fix commits to the user as-is. Only `DONE` continues to
   Submit.

   (Former steps 7–8 — per-round dispatch and the fix loop — now live
   inside the `review-branch` sub-skill, so numbering continues at 9;
   existing cross-references stay stable.)

## Submit

9. **graphify update.** Gated by the `graphify_pr_update` toggle (step 4) —
   `false` skips this step entirely; note `graphify disabled via settings` in
   the report.

   Enabled → run via `Bash(run_in_background: true)`. Graphify writes
   `graphify-out/`; always native Bash (ctx sandbox discards filesystem writes).

   Compose the command with:
   - `--force` appended when `${user_config.graphify_force_create}` is literally
     `true` (FAIL-CLOSED — new-pr never forces implicitly)
   - `--keep-user-files` appended when `${user_config.graphify_user_files}` is
     literally `true` (FAIL-CLOSED)
   - `DO_COMMIT=1` in the environment when `${user_config.graphify_pr_commit}` is
     not literally `false`; `DO_COMMIT=0` when it is literally `false`

   The script **always exits 0**; its outcome rides the `GRAPHIFY_RESULT=` /
   `COMMITTED=` lines it prints (a background script that exits non-zero is
   reported by the harness as a failed command — status must NOT ride the exit
   code, and the commit result can no longer be signalled that way either, so it
   is reported on its own line).

   ```bash
   #!/usr/bin/env bash
   # Always exits 0; status rides the GRAPHIFY_RESULT= / COMMITTED= lines below.
   set -uo pipefail
   DO_COMMIT="${DO_COMMIT:-1}"
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
   # Commit section — only reached when the update succeeded
   if [ "$DO_COMMIT" = "1" ]; then
     if git check-ignore -q graphify-out; then
       # graphify-out is gitignored (e.g. "local development only, never pushed"):
       # `git status` hides ignored files and `git add` refuses them, so there is
       # nothing to commit — report the real reason rather than "unchanged".
       echo "COMMITTED=false"; echo "COMMIT_DETAIL=graphify-out is gitignored — left local, not committed"
     elif git status --porcelain -- graphify-out | grep -q .; then
       if git add graphify-out && git commit -m "chore: update graphify output" >/dev/null 2>&1; then
         echo "COMMITTED=true"
       else
         echo "COMMITTED=false"; echo "COMMIT_DETAIL=commit failed"
       fi
     else
       echo "COMMITTED=false"; echo "COMMIT_DETAIL=graphify output unchanged"
     fi
   else
     echo "COMMITTED=skipped"
   fi
   exit 0
   ```

   Status mapping (read the `GRAPHIFY_RESULT=` line, NOT the exit code):
   - `updated` — status `updated`; then read `COMMITTED=`:
     `true` → `committed`; `false` with `COMMIT_DETAIL=graphify output unchanged`
     → `committed: false, detail: graphify output unchanged`; `false` with
     `COMMIT_DETAIL=graphify-out is gitignored …` → `committed: false — graphify-out
     is gitignored, left local` (expected when the repo keeps graphify-out
     local-only); `false` with `COMMIT_DETAIL=commit failed` → note the commit
     failed (soft); `skipped` (`DO_COMMIT=0`) → `graphify changes left uncommitted
     via settings`
   - `unavailable` — `skipped: graphify unavailable`
   - `no_folder` — `skipped: no graphify-out folder`
   - `failed` — `failed` — include the `DETAIL` excerpt
   - no `GRAPHIFY_RESULT=` line at all (e.g. the background script was killed
     before printing) — treat as `failed` (soft-fail, never block the push)

   Gate: do NOT proceed to step 10 until the background Bash notification
   arrives and its `GRAPHIFY_RESULT=` line is mapped to a status string — any
   graphify commit lands inside this background script.

   Soft-fail: any non-ok status is a report note, never a reason to stop
   before pushing.

10. **Everything committed?** Run `git status --porcelain`. Step 5 and the
   fixer rounds should have committed everything already, so this is a
   safety re-check that usually finds nothing. Commit any remainder that
   belongs to this branch's work, grouped into logical commits. Leave
   unrelated files untouched; `graphify-out` is owned by step 9 — never
   commit it here (the review-fixer carries the same standing rule); if
   it is unclear whether a change belongs to the work, ask the user.

11. **Push** the session/work branch to origin:
    - `linked_worktree:` `no` → `git push -u origin "$branch"`.
    - `linked_worktree:` `yes` → `git push --force-with-lease -u origin "$branch"`.
      In a linked worktree the branch may already exist on origin (a bridge/remote
      session can pre-push it) and init-branch may have self-rebased it, rewriting
      history relative to that ref — a plain push would then be rejected as
      non-fast-forward. `--force-with-lease` covers both cases: it creates the ref
      when origin does not have it yet, and safely force-updates a diverged ref
      (refusing only if the remote moved unexpectedly, since only this session
      writes the branch). Do NOT use a bare `--force`.

12. **Open the PR/MR** — pick the tool from the `origin` URL
    (`git remote get-url origin`):

    - GitHub (`github.com` or a GitHub Enterprise host):
      `gh pr create --base "$base" --title "<title>" --body "<body>"`
    - GitLab (`gitlab.` or a self-managed GitLab host):
      `glab mr create --target-branch "$base" --title "<title>" --description "<body>" --yes`

    If the origin URL matches neither anchor (a custom-domain Enterprise or
    self-managed host), do not guess: check `gh auth status --hostname <host>`
    and `glab auth status --hostname <host>` — if exactly one knows the host,
    use that tool; otherwise ask the user.

    Derive the title from the branch's purpose and the body from
    `git log "origin/$base"..HEAD` — what changed and why, plus which review
    rounds ran. If the required CLI is missing or unauthenticated, stop and
    give the user the exact command to run themselves.

## Monitor until green

If the `ci_monitor` toggle (step 4) is `false`, skip steps 13–15 entirely
and continue with the report (step 16), noting `CI monitoring disabled
via settings` there.

Cap the loop at 5 fix iterations — if it has not converged by then, stop and
hand the remaining findings to the user instead of pushing in circles.

13. **Dispatch `branch-management:ci-monitor`** with the platform
    (`github`/`gitlab`), the PR/MR reference, the branch name
    (`$branch` — its run-id fallback needs it), the resolved absolute
    path of `<plugin-root>/bin/ci-watch.sh` (resolve
    `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path via
    `echo "${CLAUDE_PLUGIN_ROOT}"` if not already done), the resolved CI watch timeout from step 4 (positive integer
    in seconds, fallback `1800`) and — on GitHub — the
    repository `owner`/`name` (resolve them ONCE via
    `gh repo view --json owner,name` before the first iteration and
    reuse them in every loop dispatch; the agent's GraphQL call needs
    them). It waits for the CI
    result through that script — CodeRabbit's own PR checks are excluded
    there, so a non-reacting CodeRabbit cannot block the watch — analyzes
    failing jobs and collects open CodeRabbit bot comments — read-only —
    and returns `{ci, failures, review_findings}`. If the
    `coderabbit_ci_comments` toggle (step 4) is `false`, state in the
    dispatch prompt that CodeRabbit comment collection (its step 3) must
    be skipped — `review_findings` then comes back empty and the loop
    runs on the CI state alone; note `CodeRabbit comments disabled via
    settings` in the final report.
    Gate: track this ci-monitor dispatch in the ledger; do NOT proceed to step 14
    until `TaskList` shows it terminal and its `{ci, failures, review_findings}` JSON
    is in hand.

14. **If `ci` is `red` or `review_findings` is non-empty:** dispatch
    `branch-management:review-fixer` with both lists (CI failure analyses are
    findings too). The fixer carries a standing rule to never stage
    `graphify-out` — no per-dispatch instruction needed. Then:
    - Gate: track this review-fixer dispatch in the ledger; do NOT push or resolve any
      CodeRabbit thread until `TaskList` shows it terminal and its resolutions JSON is
      in hand — so commits and `thread_id`s are never used stale.
    - If the fixer returned commits: push them.
    - For findings the fixer **skipped**, reply to the CodeRabbit thread with
      the skip reason and resolve it, using the `thread_id` from ci-monitor
      (GitHub: GraphQL mutation `resolveReviewThread`; GitLab:
      `glab api -X PUT "projects/:id/merge_requests/<iid>/discussions/<thread_id>" -f resolved=true`)
      — otherwise same finding reappears every iteration.
    - If an iteration produced no commits and CI state unchanged
      (e.g. infra flake fixer skipped), stop early and hand the
      remaining findings to user — push without commits restarts
      nothing.

15. **Loop.** Every push restarts CI and triggers CodeRabbit re-review;
    repeat steps 13–14 until both quiet in same iteration: CI green
    and no unresolved findings. CodeRabbit that never reacts (no app
    installed, rate limit exhausted) counts as quiet — loop ends on CI
    green alone.

16. **Report:** PR/MR URL — or, when stop branch fired, note
    that nothing pushed plus fix commits left on branch; include
    the review-branch sub-skill's report verbatim (rounds run,
    per-reviewer status, findings fixed/skipped, rate-limit notes) —
    or note why review rounds were skipped (no reviewer enabled,
    stopped early); monitor iterations used — or `CI monitoring
    disabled via settings` when the toggle was off.
    Plus the graphify outcome: updated + committed / updated, left
    uncommitted via settings / skipped: no CLI / skipped: no
    graphify-out folder / failed + detail / disabled via settings.
