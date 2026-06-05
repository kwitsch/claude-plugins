---
name: new-pr
description: Use when work on a branch is complete and should become a pull/merge request - runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer subagents, max 3) with verified fixes between rounds, pushes, opens a PR or MR via gh or glab, then watches CI and CodeRabbit feedback until everything is green. Review sources are switchable per project.
---

# Turn the current branch into a reviewed PR/MR

Thin orchestrator: reviews run in dedicated read-only reviewer subagents
(`claude-reviewer` on opus, the three CLI reviewers on haiku), all fixes
run in the `review-fixer` subagent (opus), CI watching runs in the
`ci-monitor` subagent (sonnet). This skill handles preconditions,
dispatching review rounds, aggregation + dedupe, the fix loop, submission
and the monitor loop — raw review output and CI logs never enter the main
context: the subagents run their commands through the context-mode
plugin, a declared dependency of this plugin (native-tool fallback only
when that dependency is broken). Review sources can be disabled per
project via `.claude/branch-management.local.md`, read in the
preconditions through `scripts/review-settings.sh`.

## Preconditions

1. **Assert a named branch:** `branch=$(git branch --show-current)`. If this
   prints nothing (detached HEAD), abort and tell the user to check out a
   branch first.

2. **Detect the base branch** (an explicit argument such as `--base develop`
   overrides the detection). Fetch first so the review runs against the
   remote's current state, and refresh the clone-time `origin/HEAD`:

   ```bash
   git fetch origin
   git remote set-head origin --auto >/dev/null 2>&1 || true
   base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
   [ -n "$base" ] || base=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
   ```

   Once `$base` is known, refresh the local base ref too — the CodeRabbit CLI
   resolves `--base` against the local branch, not the remote-tracking ref:

   ```bash
   git fetch origin "$base:$base" 2>/dev/null || true
   ```

   (The refspec update is refused when `$base` is checked out — that case
   aborts in step 3 anyway.)
   It is also refused when the local `$base` has DIVERGED from
   `origin/$base` (a local-only commit on the base). Check afterwards: if
   `git rev-parse --verify -q "$base"` and `git rev-parse --verify -q
   "origin/$base"` differ, skip the coderabbit reviewer in the review rounds and note
   "coderabbit skipped: local base diverged" in the final report — coderabbit
   diffs against the local base and would review the wrong range.

   If both come back empty, ask the user for the base branch instead of
   guessing. Everywhere below, git revisions use `origin/$base` — a local
   `$base` branch may be stale or missing entirely; only the PR/MR creation
   takes the bare name.

3. **Abort with a clear message if:**
   - the current branch *is* the base branch (nothing to open a PR from), or
   - `git log "origin/$base"..HEAD --oneline` is empty and
     `git status --porcelain` is also empty (no work to submit).

4. **Read the review toggles.** Run the bundled settings script in a
   single Bash call — deterministic parsing, do not parse the settings
   file yourself:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/review-settings.sh"
   ```

   (If `${CLAUDE_PLUGIN_ROOT}` is not set in your shell, resolve it as in
   step 6 and substitute the absolute path.)

   It prints one `<tool>=true|false` line per review source (`claude`,
   `codex`, `copilot`, `coderabbit`), merged per key from the user-level
   `~/.claude/branch-management.local.md` and the project-level
   `.claude/branch-management.local.md` (project wins; only explicit
   `true`/`false` values assign). Missing or malformed settings files
   yield all `true` (fail-open) —
   only an explicit `false` (case-insensitive) disables a source. Keep
   the four values for the rest of the run; every disabled source appears
   in the final report as `disabled via settings`. The toggles gate the
   review rounds only — the monitor loop is unaffected: ci-monitor keeps
   collecting CodeRabbit bot comments even when `coderabbit=false`. All
   four toggles `false` is allowed — the run then proceeds without any
   pre-push review; flag that prominently in the final report.

## Review rounds

5. **Commit pending work.** This is mandatory, not housekeeping: codex
   and copilot diff committed state against `origin/$base`, and
   coderabbit diffs against the local `$base` (refreshed in the
   preconditions) — so uncommitted work-tree edits are invisible to the
   reviewers. Commit only changes that belong to this branch's work; if
   it is unclear whether a change belongs, ask the user.

6. **Dispatch a review round** — ALL enabled reviewers in ONE message.
   One step-6 dispatch is one round: track the round number, the first
   dispatch is round 1, the cap is 3 rounds per run. Enabled means: the
   step-4 toggle is `true`;
   the coderabbit-reviewer is additionally omitted when step 2 found the
   local base diverged (toggle off → `disabled via settings` in the
   report, diverged base → the existing note). If the dispatch set is
   empty — no reviewer is both enabled and eligible — skip the review
   rounds entirely and continue with the Submit stage. The reviewers run
   in parallel; all are read-only, so concurrent runs cannot conflict:

   - `branch-management:claude-reviewer`
   - `branch-management:codex-reviewer`
   - `branch-management:copilot-reviewer`
   - `branch-management:coderabbit-reviewer`

   Resolve `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path first (e.g.
   `echo "${CLAUDE_PLUGIN_ROOT}"`) — the CLI reviewer subagents expect a
   literal absolute script path, not a variable. Each CLI dispatch prompt
   must contain: the base branch name (`$base`, bare) and the resolved
   absolute path of
   `<plugin-root>/scripts/<codex|copilot|coderabbit>-review.sh`. The
   claude-reviewer dispatch prompt contains only the base branch name.
   The CLI reviewers execute their script through context-mode's
   `ctx_execute` (declared dependency) and report a degradation in their
   result if they had to fall back to Bash — carry such notes into the
   final report.

   Each agent returns `{tool, status, login_hint?, error?, findings}`. Handle
   statuses:
   - `missing` — skip silently; absence is not an error.
   - `no_auth` — skip; record the `login_hint` for the final report.
   - `failed` — skip; record the `error` for the final report (the
     claude-reviewer only knows `ok|failed`).
   - An unparsable agent reply counts as `failed` with empty findings.
   - An `error` carrying a degradation note (`… ran via Bash`,
     `partial review — diff too large`) can appear on any status — carry
     such notes into the final report.

   Every enabled source runs in every round; one that drops out mid-run
   (e.g. a coderabbit rate limit) degrades softly via these statuses. A
   round in which every dispatched reviewer returned
   `missing`/`no_auth`/`failed` simply produces zero findings and flows
   through step 8's quiet branch — it does not loop. That is fine: the
   monitor loop remains as the review net.

7. **Aggregate and dedupe** the round's findings across all sources:
   merge findings that point at the same file and overlapping lines and
   describe the same root cause — keep the most precise description, note
   every source tool. Treat `line: 0` (file-level) findings as
   overlapping only when their titles describe the same issue. This is
   pure data work on the JSON — do not open the files here. Then drop
   every finding already on the skip list (findings the fixer skipped
   with a reason in an earlier round; key: file + line + normalized
   title, case-insensitive with collapsed whitespace — file + title alone
   for `line: 0`) so a rejected finding cannot ping-pong between reviewer
   and fixer. The skip list lives in your context for the rest of the
   run.

8. **Decide:**
   - **No findings left** → the round is quiet; continue with the Submit
     stage.
   - **Findings left and this was round 3** → do NOT dispatch the fixer
     again — a fix without a verification round would go out unreviewed.
     STOP before pushing anything and hand the open findings to the
     user.
   - **Findings left, rounds remaining** → dispatch
     `branch-management:review-fixer` ONCE with the full deduplicated
     findings JSON and the base branch. It verifies each finding against
     the code, fixes the justified ones, skips the rest with reasons,
     and commits. Add its skipped findings (with reasons) to the skip
     list and the report — the fixer's resolutions carry no `line`, so
     recover it by matching each skipped resolution (file + title) back
     against the deduplicated findings JSON you just dispatched. Then:
     - The fixer produced at least one commit → start the next review
       round (step 6).
     - The fixer produced no commit (everything skipped) → treat as
       converged; continue with the Submit stage.

## Submit

9. **Everything committed?** Run `git status --porcelain`. Step 5 and the
   fixer rounds should have committed everything already, so this is a
   safety re-check that usually finds nothing. Commit any remainder that
   belongs to this branch's work, grouped into logical commits. Leave
   unrelated files untouched; if it is unclear whether a change belongs
   to the work, ask the user.

10. **Push:** `git push -u origin "$branch"`.

11. **Open the PR/MR** — pick the tool from the `origin` URL
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

Cap the loop at 5 fix iterations — if it has not converged by then, stop and
hand the remaining findings to the user instead of pushing in circles.

12. **Dispatch `branch-management:ci-monitor`** with the platform
    (`github`/`gitlab`), the PR/MR reference, the branch name
    (`$branch` — its run-id fallback needs it) and the resolved absolute
    path of `<plugin-root>/scripts/ci-watch.sh`. It waits for the CI
    result through that script — CodeRabbit's own PR checks are excluded
    there, so a non-reacting CodeRabbit cannot block the watch — analyzes
    failing jobs and collects open CodeRabbit bot comments — read-only —
    and returns `{ci, failures, review_findings}`.

13. **If `ci` is `red` or `review_findings` is non-empty:** dispatch
    `branch-management:review-fixer` with both lists (CI failure analyses are
    findings too). Then:
    - If the fixer returned commits: push them.
    - For findings the fixer **skipped**, reply to the CodeRabbit thread with
      the skip reason and resolve it, using the `thread_id` from ci-monitor
      (GitHub: GraphQL mutation `resolveReviewThread`; GitLab:
      `glab api -X PUT "projects/:id/merge_requests/<iid>/discussions/<thread_id>" -f resolved=true`)
      — otherwise the same finding reappears every iteration.
    - If an iteration produced no commits and the CI state is unchanged
      (e.g. an infra flake the fixer skipped), stop early and hand the
      remaining findings to the user — a push without commits restarts
      nothing.

14. **Loop.** Every push restarts the CI and triggers a CodeRabbit re-review;
    repeat steps 12–13 until both are quiet in the same iteration: CI green
    and no unresolved findings. A CodeRabbit that never reacts (no app
    installed, rate limit exhausted) counts as quiet — the loop ends on CI
    green alone.

15. **Report:** the PR/MR URL; the number of review rounds and their
    outcome (quiet / converged via fixer skips / capped at 3 with open
    findings); per review source its latest status (claude: ran / partial
    (diff too large) / failed + reason / **disabled via settings**; CLI
    tools: ran / missing,
    skipped silently / **not logged in + login command** / failed +
    reason / **disabled via settings**); findings fixed/skipped per
    round; monitor iterations used.
