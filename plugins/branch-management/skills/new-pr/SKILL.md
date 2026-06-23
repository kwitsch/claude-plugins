---
name: new-pr
description: Use when branch work complete and should become pull/merge request - runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer subagents, configurable max rounds) with verified fixes between rounds, pushes, opens PR or MR via gh or glab, then watches CI and CodeRabbit feedback until all green. Review sources can be disabled per user or per project.
argument-hint: "[--base <branch>]"
allowed-tools: ["Agent", "Skill", "AskUserQuestion", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)", "Bash(echo:*)", "Bash(bash:*)", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

# Turn the current branch into a reviewed PR/MR

Thin orchestrator: reviews run in dedicated read-only reviewer subagents
(`claude-reviewer` on opus, three CLI reviewers on haiku), all fixes
run in `review-fixer` subagent (opus), CI watch runs in
`ci-monitor` subagent (sonnet). Skill handles preconditions,
dispatching review rounds, aggregation + dedupe, fix loop, submission
and monitor loop — raw review output and CI logs never enter main
context: subagents keep heavy output out of the main context. Review
sources, CI monitoring and CodeRabbit comment handling
are individually togglable via the plugin's `userConfig` options,
read in preconditions (step 4).

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; wt=no; [ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ] && wt=yes; printf "current_branch: %s\ndetected_base: %s\nlinked_worktree: %s\n" "$(git branch --show-current)" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')" "$wt"`

## Preconditions

1. **Assert a named branch:** from the git context above, extract the
   value on the `current_branch:` line and assign it to `$branch`. If
   empty (detached HEAD), abort and tell user to check out a branch first.
   Also note the `linked_worktree:` value (`yes`/`no`) — it governs the push in
   step 10.

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

4. **Read CI toggles.** The plugin declares them via
   `userConfig` in plugin.json; Claude Code stores the values in
   settings.json under `pluginConfigs["branch-management"].options`
   (native scope precedence: local > project > user) and interpolates
   them directly into this skill:

   | Toggle | Value |
   |---|---|
   | ci_monitor | `${user_config.ci_monitor}` |
   | ci_watch_timeout | `${user_config.ci_watch_timeout}` |
   | coderabbit_ci_comments | `${user_config.coderabbit_ci_comments}` |
   | delete_branch_on_merge | `${user_config.delete_branch_on_merge}` |
   | rebase_before_pr | `${user_config.rebase_before_pr}` |

   Evaluation rule (fail-open): ONLY the literal value `false` disables
   a toggle. Anything else — `true`, an empty value, or an
   uninterpolated `${user_config.…}` placeholder on an older Claude
   Code version — counts as enabled. `ci_watch_timeout` is numeric:
   use the literal value only when it is a positive whole-number value;
   otherwise fall back to `1800`. `ci_monitor` gates the whole monitor
   loop (steps 12–14), while `coderabbit_ci_comments` only suppresses
   CodeRabbit comment collection within step 12. `delete_branch_on_merge` gates the
   auto-delete-on-merge wiring in step 11. `rebase_before_pr` gates the
   onto-latest-base rebase in step 8.

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

   (The former per-round dispatch and fix loop now live inside the
   `review-branch` sub-skill. Step 8 below is the pre-submit base rebase;
   numbering then continues at 9 — existing cross-references stay stable.)

8. **Rebase onto the latest base** — after the work is committed (step 5) and the
   review rounds have settled (step 6), and **before** pushing,
   check whether the base branch (`$base` — the branch the work was cut from, usually
   `main`) gained new upstream commits and, if so, rebase the work branch onto it.
   This keeps the PR on top of current `$base` and surfaces conflicts now instead of
   in the PR. Gated by the `rebase_before_pr` toggle (step 4) — literally `false`
   skips this step (note `rebase before PR disabled via settings`).

   **Synchronous, native Bash** (git fetch + rebase are writes — never the ctx
   sandbox). Pass `$base` (the bare base name from precondition 2) as `$1`.

   ```bash
   #!/usr/bin/env bash
   # Rebase the work branch onto the latest origin/<base>. Run from the work tree.
   # Always exits 0; outcome on the REBASE_RESULT= line (not the exit code).
   set -uo pipefail
   base="${1:?usage: <base>}"
   if [ -n "$(git status --porcelain)" ]; then echo "REBASE_RESULT=skipped_dirty"; exit 0; fi
   if ! out="$(git fetch origin "$base" 2>&1)"; then
     echo "REBASE_RESULT=failed"; echo "DETAIL=fetch: $(printf '%s' "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; exit 0
   fi
   # already contains every origin/<base> commit? then base has no new upstream work
   if git merge-base --is-ancestor "origin/$base" HEAD; then
     echo "REBASE_RESULT=up_to_date"; exit 0
   fi
   if git rebase "origin/$base" >/dev/null 2>&1; then
     echo "REBASE_RESULT=rebased"
   else
     git rebase --abort >/dev/null 2>&1 || true   # never leave a half-rebased tree
     echo "REBASE_RESULT=conflict"
   fi
   exit 0
   ```

   Map the `REBASE_RESULT=` line:
   - `up_to_date` → base has no new commits; nothing to do, continue.
   - `rebased` → the branch was replayed onto new base commits; **history was
     rewritten**, so set a `rebased=yes` marker — step 10's push MUST then use
     `--force-with-lease`. Continue.
   - `skipped_dirty` → uncommitted changes remain (shouldn't happen after step 5 /
     the fixer); commit or stash them and re-run this step. Never rebase a dirty tree.
   - `conflict` → the rebase hit conflicts and was aborted (branch unchanged). Do
     **not** push or open a PR — stop and hand the conflict to the user to resolve
     manually (a PR that cannot land cleanly on `$base` is worse than stopping).
   - `failed` → fetch/setup failed (e.g. offline); report `DETAIL` as a soft note and
     continue — the branch is still pushable, the PR just may sit behind `$base`.
   - no `REBASE_RESULT=` line → treat as `failed` (soft note).

## Submit

9. **Everything committed?** Run `git status --porcelain`. Step 5 and the
   fixer rounds should have committed everything already, so this is a
   safety re-check that usually finds nothing. Commit any remainder that
   belongs to this branch's work, grouped into logical commits. Leave
   unrelated files untouched; if it is unclear whether a change belongs
   to the work, ask the user.

10. **Push** the session/work branch to origin. Use `--force-with-lease` when the
    history may have been rewritten relative to an existing remote ref — i.e. when
    `linked_worktree:` is `yes` (a bridge/remote session can pre-push the branch and
    new-branch may have self-rebased it) **or** step 8 reported `rebased=yes`.
    Otherwise a plain push:
    - neither condition → `git push -u origin "$branch"`.
    - `linked_worktree:` `yes` OR step-8 `rebased=yes` →
      `git push --force-with-lease -u origin "$branch"`.

    `--force-with-lease` covers both regimes: it creates the ref when origin does
    not have it yet, and safely force-updates a diverged ref (refusing only if the
    remote moved unexpectedly, since only this session writes the branch). Do NOT
    use a bare `--force`.

11. **Open the PR/MR** — pick the tool from the `origin` URL
    (`git remote get-url origin`):

    - GitHub (`github.com` or a GitHub Enterprise host):
      `gh pr create --base "$base" --title "<title>" --body "<body>"`
    - GitLab (`gitlab.` or a self-managed GitLab host):
      `glab mr create --target-branch "$base" --title "<title>" --description "<body>" --yes`
      — append `--remove-source-branch` unless `delete_branch_on_merge` (step 4)
      is literally `false`, so the source branch is removed when the MR merges.

    If the origin URL matches neither anchor (a custom-domain Enterprise or
    self-managed host), do not guess: check `gh auth status --hostname <host>`
    and `glab auth status --hostname <host>` — if exactly one knows the host,
    use that tool; otherwise ask the user.

    Derive the title from the branch's purpose and the body from
    `git log "origin/$base"..HEAD` — what changed and why, plus which review
    rounds ran. If the required CLI is missing or unauthenticated, stop and
    give the user the exact command to run themselves.

    **Auto-delete the branch on merge** (unless `delete_branch_on_merge` from
    step 4 is literally `false`). `gh pr create` has no per-PR flag for this, so
    on **GitHub** ensure the repo-level setting after the PR is open — idempotent,
    soft-fail, never a reason to abort (it needs admin; a non-admin token just
    leaves it unchanged):

    ```bash
    # GitHub only; skip entirely when delete_branch_on_merge is literally false.
    if [ "$(gh repo view --json deleteBranchOnMerge -q .deleteBranchOnMerge 2>/dev/null)" != "true" ]; then
      gh api -X PATCH "repos/{owner}/{repo}" -F delete_branch_on_merge=true >/dev/null 2>&1 \
        && echo "auto-delete: enabled repo delete_branch_on_merge" \
        || echo "auto-delete: could not set delete_branch_on_merge (likely no admin) — left as-is"
    else
      echo "auto-delete: repo delete_branch_on_merge already true"
    fi
    ```

    `{owner}/{repo}` is resolved by `gh` from the origin remote — pass the literal
    placeholder string. On **GitLab** the `--remove-source-branch` flag above
    already covers this per-MR; no repo-level change is made. Record the
    auto-delete outcome for the report (step 15).

## Monitor until green

If the `ci_monitor` toggle (step 4) is `false`, skip steps 12–14 entirely
and continue with the report (step 15), noting `CI monitoring disabled
via settings` there.

Cap the loop at 5 fix iterations — if it has not converged by then, stop and
hand the remaining findings to the user instead of pushing in circles.

12. **Dispatch `branch-management:ci-monitor`** with the platform
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
    Gate: track this ci-monitor dispatch in the ledger; do NOT proceed to step 13
    until `TaskList` shows it terminal and its `{ci, failures, review_findings}` JSON
    is in hand.

13. **If `ci` is `red` or `review_findings` is non-empty:** dispatch
    `branch-management:review-fixer` with both lists (CI failure analyses are
    findings too). Then:
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

14. **Loop.** Every push restarts CI and triggers CodeRabbit re-review;
    repeat steps 12–13 until both quiet in same iteration: CI green
    and no unresolved findings. CodeRabbit that never reacts (no app
    installed, rate limit exhausted) counts as quiet — loop ends on CI
    green alone.

15. **Report:** PR/MR URL — or, when stop branch fired, note
    that nothing pushed plus fix commits left on branch; include
    the review-branch sub-skill's report verbatim (rounds run,
    per-reviewer status, findings fixed/skipped, rate-limit notes) —
    or note why review rounds were skipped (no reviewer enabled,
    stopped early); monitor iterations used — or `CI monitoring
    disabled via settings` when the toggle was off.
    Plus the auto-delete-on-merge outcome from step 11: enabled repo
    `delete_branch_on_merge` / already true / could not set (no admin) /
    GitLab `--remove-source-branch` set / disabled via settings.
    Plus the step-8 base-rebase outcome: up to date / rebased onto
    `origin/$base` (force-pushed) / conflict — stopped / failed + detail /
    disabled via settings.
