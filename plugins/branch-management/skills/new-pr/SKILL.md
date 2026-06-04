---
name: new-pr
description: Use when work on a branch is complete and should become a pull/merge request - runs code-review --fix plus parallel codex/copilot/coderabbit CLI reviews through dedicated reviewer subagents, applies verified fixes through a fixer subagent, pushes, opens a PR or MR via gh or glab, then watches CI and CodeRabbit feedback in a fix-push loop until everything is green.
---

# Turn the current branch into a reviewed PR/MR

Thin orchestrator: reviews run in dedicated reviewer subagents (haiku) that
execute the bundled CLI scripts, all fixes run in the `review-fixer` subagent
(opus), CI watching runs in the `ci-monitor` subagent (sonnet). This skill
handles preconditions, dispatching, dedupe, submission and the monitor loop —
raw review output and CI logs never enter the main context.

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

   If both come back empty, ask the user for the base branch instead of
   guessing. Everywhere below, git revisions use `origin/$base` — a local
   `$base` branch may be stale or missing entirely; only the PR/MR creation
   takes the bare name.

3. **Abort with a clear message if:**
   - the current branch *is* the base branch (nothing to open a PR from), or
   - `git log "origin/$base"..HEAD --oneline` is empty and
     `git status --porcelain` is also empty (no work to submit).

## Stage 1 — built-in code review

Invoke the `code-review` skill with `--fix`. Its default scope — the branch
diff against the upstream/base plus the working tree — is exactly what should
be reviewed here; do not invent flags it does not have. If no `code-review`
skill is available in this session, review
`git diff "origin/$base"...HEAD` plus the working tree yourself with the same
goal — correctness bugs first — and apply the fixes. Commit the fixes before
stage 2 so the CLI reviewers see them.

## Stage 2 — parallel CLI reviews

Dispatch all three reviewer subagents in ONE message (they run in parallel;
the scripts are read-only, so this is safe):

- `branch-management:codex-reviewer`
- `branch-management:copilot-reviewer`
- `branch-management:coderabbit-reviewer`

Each dispatch prompt must contain: the base branch name (`$base`, bare) and
the absolute script path
`${CLAUDE_PLUGIN_ROOT}/scripts/<codex|copilot|coderabbit>-review.sh`.

Each agent returns `{tool, status, login_hint?, error?, findings}`. Handle
statuses:
- `missing` — skip silently; absence is not an error.
- `no_auth` — skip; record the `login_hint` for the final report.
- `failed` — skip; record the `error` for the final report.
- An unparsable agent reply counts as `failed` with empty findings.

No CLI available at all is fine — stage 1 and the monitor loop remain as the
review net.

## Dedupe

Merge findings that point at the same file and overlapping lines and describe
the same root cause: keep the most precise description, note every source
tool. This is pure data work on the JSON — do not open the files here.

## Fixer pass

If any findings remain, dispatch `branch-management:review-fixer` ONCE with
the full deduplicated findings JSON and the base branch. It verifies each
finding against the code, fixes the justified ones, skips the rest with
reasons, and commits. No findings → skip this step.

## Submit

4. **Everything committed?** Run `git status --porcelain`. Commit remaining
   changes that belong to this branch's work, grouped into logical commits.
   Leave unrelated files untouched; if it is unclear whether a change belongs
   to the work, ask the user.

5. **Push:** `git push -u origin "$branch"`.

6. **Open the PR/MR** — pick the tool from the `origin` URL
   (`git remote get-url origin`):

   - GitHub (`github.com` or a GitHub Enterprise host):
     `gh pr create --base "$base" --title "<title>" --body "<body>"`
   - GitLab (`gitlab.` or a self-managed GitLab host):
     `glab mr create --target-branch "$base" --title "<title>" --description "<body>"`

   Derive the title from the branch's purpose and the body from
   `git log "origin/$base"..HEAD` — what changed and why, plus which review
   stages ran. If the required CLI is missing or unauthenticated, stop and
   give the user the exact command to run themselves.

## Monitor until green

Cap the loop at 5 fix iterations — if it has not converged by then, stop and
hand the remaining findings to the user instead of pushing in circles.

7. **Dispatch `branch-management:ci-monitor`** with the platform
   (`github`/`gitlab`) and the PR/MR reference. It waits for the CI result,
   analyzes failing jobs and collects unresolved CodeRabbit bot comments —
   read-only — and returns `{ci, failures, review_findings}`.

8. **If `ci` is `red` or `review_findings` is non-empty:** dispatch
   `branch-management:review-fixer` with both lists (CI failure analyses are
   findings too), then push the fix commits.

9. **Loop.** Every push restarts the CI and triggers a CodeRabbit re-review;
   repeat steps 7–8 until both are quiet in the same iteration: CI green and
   no unresolved findings.

10. **Report:** the PR/MR URL; per CLI tool its status (ran / missing,
    skipped silently / **not logged in + login command** / failed + reason);
    findings fixed/skipped per stage; monitor iterations used.
