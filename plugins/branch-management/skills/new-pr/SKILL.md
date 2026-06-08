---
name: new-pr
description: Use when branch work complete and should become pull/merge request - runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer subagents, configurable max rounds) with verified fixes between rounds, pushes, opens PR or MR via gh or glab, then watches CI and CodeRabbit feedback until all green. Optionally refreshes and separately commits the graphify output before pushing. Review sources can be disabled per user or per project.
argument-hint: "[--base <branch>]"
allowed-tools: ["Agent", "Skill", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)", "Bash(echo:*)"]
---

# Turn the current branch into a reviewed PR/MR

Thin orchestrator: reviews run in dedicated read-only reviewer subagents
(`claude-reviewer` on opus, three CLI reviewers on haiku), all fixes
run in `review-fixer` subagent (opus), CI watch runs in
`ci-monitor` subagent (sonnet). Skill handles preconditions,
dispatching review rounds, aggregation + dedupe, fix loop, submission
and monitor loop — raw review output and CI logs never enter main
context: subagents run commands through context-mode plugin, declared
dependency of this plugin (native-tool fallback only when dependency
broken). Review sources, CI monitoring and CodeRabbit comment handling
are individually togglable via the plugin's `userConfig` options,
read in preconditions (step 4).

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; printf "current_branch: %s\ndetected_base: %s\n" "$(git branch --show-current)" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"`

## Preconditions

1. **Assert a named branch:** from the git context above, extract the
   value on the `current_branch:` line and assign it to `$branch`. If
   empty (detached HEAD), abort and tell user to check out a branch first.

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
   aborts in step 3 anyway.) If `git rev-parse --verify -q "$base"` and
   `git rev-parse --verify -q "origin/$base"` differ, skip coderabbit in
   review rounds and note "coderabbit skipped: local base diverged" in
   the final report. Everywhere below, git revisions use `origin/$base` —
   only the PR/MR creation takes the bare name.

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
   | graphify_user_files | `${user_config.graphify_user_files}` |

   Evaluation rule (fail-open): ONLY the literal value `false` disables
   a toggle. Anything else — `true`, an empty value, or an
   uninterpolated `${user_config.…}` placeholder on an older Claude
   Code version — counts as enabled. Exception: `graphify_user_files`
   is FAIL-CLOSED — ONLY the literal value `true` keeps human-only
   graphify files (see step 9). `ci_watch_timeout` is numeric:
   use the literal value only when it is a positive whole-number value;
   otherwise fall back to `1800`. `ci_monitor` gates the whole monitor
   loop (steps 13–15), while `coderabbit_ci_comments` only suppresses
   CodeRabbit comment collection within step 13. `graphify_pr_update`
   gates the graphify refresh in the Submit stage (step 9) and
   `graphify_pr_commit` its separate commit.

   Review toggles (`review_claude/codex/copilot/coderabbit`),
   `review_max_rounds`, and reviewer quota checks are handled
   autonomously by the `review-branch` sub-skill (step 6).

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

   If `review-branch` stops with open findings (max rounds reached or
   no review source succeeded), do not proceed to Submit — surface the
   findings and any unpushed fix commits to the user as-is.

## Submit

9. **graphify update.** Gated by the `graphify_pr_update` toggle
   (step 4) — `false` skips this step entirely; note
   `graphify disabled via settings` in the report. Enabled → invoke
   the `branch-management:graphify-update` skill (Skill tool) with
   `--commit` when `graphify_pr_commit` is not `false`, no `--commit`
   otherwise. The sub-skill reads `graphify_force_create` and
   `graphify_user_files` toggles autonomously (new-pr never passes
   `--force`; `--user-files` is toggle-driven within the sub-skill).
   - With `--commit`: sub-skill commits refreshed graphify files as a
     separate `chore: update graphify output` commit — generated
     artifacts, intentionally NOT covered by the review rounds.
   - Without `--commit`: graphify changes stay uncommitted (step 10
     and the review-fixer leave `graphify-out` alone); note
     `graphify changes left uncommitted via settings` in the report.
   - Soft-fail: any non-ok status is a report note, never a reason to
     stop before pushing.

10. **Everything committed?** Run `git status --porcelain`. Step 5 and the
   fixer rounds should have committed everything already, so this is a
   safety re-check that usually finds nothing. Commit any remainder that
   belongs to this branch's work, grouped into logical commits. Leave
   unrelated files untouched; `graphify-out` is owned by step 9 — never
   commit it here (the review-fixer carries the same standing rule); if
   it is unclear whether a change belongs to the work, ask the user.

11. **Push:** `git push -u origin "$branch"`.

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
    path of `<plugin-root>/scripts/ci-watch.sh` (resolve
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

14. **If `ci` is `red` or `review_findings` is non-empty:** dispatch
    `branch-management:review-fixer` with both lists (CI failure analyses are
    findings too). The fixer carries a standing rule to never stage
    `graphify-out` — no per-dispatch instruction needed. Then:
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
