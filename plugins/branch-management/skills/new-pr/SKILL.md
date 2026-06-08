---
name: new-pr
description: Use when branch work complete and should become pull/merge request - runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer subagents, configurable max rounds) with verified fixes between rounds, pushes, opens PR or MR via gh or glab, then watches CI and CodeRabbit feedback until all green. Optionally refreshes and separately commits the graphify output before pushing. Review sources can be disabled per user or per project.
argument-hint: "[--base <branch>]"
allowed-tools: ["Agent", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)", "Bash(echo:*)", "Bash(*/quota-state.sh*)"]
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

## Preconditions

1. **Assert a named branch:** `branch=$(git branch --show-current)`. If this
   prints nothing (detached HEAD), abort and tell user check out a
   branch first.

<!-- same origin/HEAD detection recipe as agents/branch-agent.md step 2 — keep in sync -->
2. **Detect the base branch** (explicit argument like `--base develop`
   overrides detection). Fetch first so review runs against the
   remote's current state, and refresh clone-time `origin/HEAD`:

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

4. **Read the feature toggles.** The plugin declares them via
   `userConfig` in plugin.json; Claude Code stores the values in
   settings.json under `pluginConfigs["branch-management"].options`
   (native scope precedence: local > project > user) and interpolates
   them directly into this skill:

   | Toggle | Value |
   |---|---|
   | claude | `${user_config.review_claude}` |
   | codex | `${user_config.review_codex}` |
   | copilot | `${user_config.review_copilot}` |
   | coderabbit | `${user_config.review_coderabbit}` |
   | ci_monitor | `${user_config.ci_monitor}` |
   | ci_watch_timeout | `${user_config.ci_watch_timeout}` |
   | coderabbit_ci_comments | `${user_config.coderabbit_ci_comments}` |
   | graphify_pr_update | `${user_config.graphify_pr_update}` |
   | graphify_pr_commit | `${user_config.graphify_pr_commit}` |
   | graphify_user_files | `${user_config.graphify_user_files}` |
   | review_max_rounds | `${user_config.review_max_rounds}` |

   Evaluation rule (fail-open): ONLY the literal value `false` disables
   a toggle. Anything else — `true`, an empty value, or an
   uninterpolated `${user_config.…}` placeholder on an older Claude
   Code version — counts as enabled. Exception: `graphify_user_files`
   is FAIL-CLOSED — ONLY the literal value `true` keeps human-only
   graphify files (see step 9). `ci_watch_timeout` is numeric:
   use the literal value only when it is a positive whole-number value;
   otherwise fall back to `1800`. Resolve `review_max_rounds`: parse
   `${user_config.review_max_rounds}` as a positive integer; if empty,
   an uninterpolated placeholder, or not a valid positive integer, use
   `3`; clamp to minimum `1`. Store the result as `$max_rounds` for
   steps 6 and 8. Keep all eleven values for the rest of the run;
   every disabled review source appears in the final report as
   `disabled via settings`. The four review toggles gate the review
   rounds only; `ci_monitor` gates the whole monitor loop (steps 13–15),
   while `coderabbit_ci_comments` only suppresses CodeRabbit comment
   collection within step 13. `graphify_pr_update` gates the graphify
   refresh in the Submit stage (step 9) and `graphify_pr_commit` its
   separate commit. All four review toggles `false` is allowed — the run
   then proceeds without any pre-push review; flag that prominently in
   the final report.

   Also resolve the absolute path of
   `<plugin-root>/scripts/quota-state.sh` (same method as the review
   scripts in step 6 — resolve `${CLAUDE_PLUGIN_ROOT}` once) and store
   it as `$quota_sh`. For each of the four reviewer toggles that is
   enabled (not `false`), run `"$quota_sh" check <tool>` — where
   `<tool>` is `claude`, `codex`, `copilot`, or `coderabbit`. Exit 0
   means the reviewer is quota-limited until the reset epoch printed on
   stdout; add it to a `quota_limited` set and treat it identically to a
   `false` toggle for this entire run, storing the reset epoch for the
   final report. Exit 1 means the reviewer is clear. The `check` command
   auto-deletes expired quota files.

## Review rounds

5. **Commit pending work.** This is mandatory, not housekeeping: codex
   and copilot diff committed state against `origin/$base`, and
   coderabbit diffs against the local `$base` (refreshed in the
   preconditions) — so uncommitted work-tree edits are invisible to the
   reviewers. Commit only changes that belong to this branch's work; if
   it is unclear whether a change belongs, ask the user.

6. **Dispatch a review round** — ALL enabled reviewers in ONE message.
   One step-6 dispatch is one round: track the round number, the first
   dispatch is round 1, the cap is $max_rounds rounds per run. Enabled means: the
   step-4 toggle is not `false`;
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

   Resolve `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path ONCE (e.g.
   `echo "${CLAUDE_PLUGIN_ROOT}"`) and reuse the value in steps 9 and
   13 — the subagents expect a literal absolute script path, not a
   variable. Each CLI dispatch prompt
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
     claude-reviewer only knows `ok|failed` and never emits a
     `login_hint`).
   - An unparsable agent reply counts as `failed` with empty findings.
   - An `error` carrying a degradation note (e.g. `… ran via Bash`,
     `… ran via native tools`, `partial review — diff too large`) can
     appear on any status — carry such notes into the final report.

   Every enabled source runs in every round; one that drops out mid-run
   (e.g. a coderabbit rate limit) degrades softly via these statuses —
   as long as at least one reviewer returns `ok`, the round counts. A
   round in which EVERY dispatched reviewer failed reviewed nothing;
   step 8 handles that case explicitly (one retry, then stop).

7. **Aggregate and dedupe** the round's findings across all sources:
   merge findings that point at the same file and overlapping lines and
   describe the same root cause — keep the most precise description, note
   every source tool. Treat `line: 0` (file-level) findings as
   overlapping only when their titles describe the same issue. This is
   pure data work on the JSON — do not open the files here. Then drop
   every finding that matches an entry on the skip list (the full
   finding objects the fixer skipped with a reason in earlier rounds): a
   new finding matches a skip entry when it points at the same file and
   describes the same root cause — same or clearly equivalent title, or
   nearby lines (fix commits shift line numbers, so judge proximity, not
   equality). This is a semantic comparison you make yourself; when
   unsure, let the finding through — the fixer will re-verify it. The
   skip list lives in your context for the rest of the run.

8. **Record quota hits, then decide.** For each reviewer with
   `status: "failed"` in this round, run
   `"$quota_sh" record <tool> "<error>"` — exit 0 means the error
   matched a rate-limit pattern; add the reviewer to `quota_limited`
   and exclude it from subsequent round dispatches, noting it in the
   final report as rate-limited. Then:
   - **No reviewer in the round returned `ok`** (every dispatched one
     came back `missing`/`no_auth`/`failed`): the round reviewed
     nothing — do not treat it as quiet. Retry the round ONCE (the retry
     does not count against the cap); if the retry also yields no `ok`
     source, STOP before pushing and tell the user that no review source
     succeeded.
   - **No findings left** → the round is quiet; continue with the Submit
     stage. If the only `ok` review carried a `partial review` note, say
     so prominently in the report — the unreviewed hunks were not
     covered.
   - **Findings left and this was round $max_rounds** → do NOT dispatch the fixer
     again — a fix without a verification round would go out unreviewed.
     STOP before pushing anything and hand the open findings to the
     user, naming the fix commits from earlier rounds that now sit
     unpushed on the branch (list them via `git log`) so that work is
     not lost.
   - **Findings left, rounds remaining** → assign each deduplicated
     finding a stable `id` (`F1`, `F2`, …), then dispatch
     `branch-management:review-fixer` ONCE with the full deduplicated
     findings JSON (including the ids) and the base branch. It verifies
     each finding against the code, fixes the justified ones, skips the
     rest with reasons, commits, and echoes each finding's `id` in its
     resolutions. Add the skipped findings — looked up by `id` in the
     JSON you dispatched — to the skip list (full finding object plus
     the fixer's reason) and the report. Run `git status --porcelain`
     afterwards and commit any leftover fix edits that belong to the
     branch. Then:
     - The fixer produced at least one commit → start the next review
       round (step 6).
     - The fixer produced no commit (everything skipped) → treat as
       converged; continue with the Submit stage.

## Submit

9. **graphify update.** Gated by the `graphify_pr_update` toggle
   (step 4) — `false` skips this step entirely; note
   `graphify disabled via settings` in the report. Enabled → dispatch
   `branch-management:graphify-agent` (plugin root as resolved in
   step 6; resolve it now if the review rounds were skipped) with: the
   absolute path of
   `<plugin-root>/scripts/graphify-update.sh`, `force: no` (new-pr
   never creates the folder — a missing `graphify-out/` comes back as
   `skipped_no_dir`; just note it in the report), `commit:` from
   the `graphify_pr_commit` toggle (`false` → `commit: no`, anything
   else → `commit: yes`), and `user_files:` from the
   `graphify_user_files` toggle (FAIL-CLOSED: ONLY the literal value
   `true` means `user_files: yes` — the graphify output serves agents,
   so human-only files like graph.html are pruned unless explicitly
   kept).
   - With `commit: yes` the agent commits refreshed graphify files as a
     separate `chore: update graphify output` commit — generated
     artifacts, intentionally NOT covered by the review rounds.
   - With `commit: no` while the update ran: the graphify changes stay
     uncommitted (step 10 and the review-fixer leave `graphify-out`
     alone); note `graphify changes left uncommitted via settings` in
     the report.
   - Soft-fail: a `failed` status is a report note, never a reason to
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
    path of `<plugin-root>/scripts/ci-watch.sh` (plugin root as resolved
    in step 6; resolve it now if both the review rounds and step 9 were
    skipped), the resolved CI watch timeout from step 4 (positive integer
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
    that nothing pushed plus fix commits left on branch; the
    number of review rounds and their outcome (quiet / converged via
    fixer skips / capped at $max_rounds with open findings / stopped: no
    review source succeeded / skipped: no reviewer enabled); per review
    source its latest status (claude: ran / partial (diff too large) /
    failed + reason / **disabled via settings** / **rate-limited until
    HH:MM** (call `"$quota_sh" format_time <epoch>` for the time); CLI
    tools: ran / missing, skipped silently / **not logged in + login
    command** / failed + reason / **disabled via settings** /
    **rate-limited until HH:MM**); findings fixed/skipped per
    round; monitor iterations used — or `CI monitoring disabled via
    settings` when the toggle was off.
    Plus the graphify outcome: updated + committed / updated, left
    uncommitted via settings / skipped: no CLI / skipped: no
    graphify-out folder / failed + detail / disabled via settings.
