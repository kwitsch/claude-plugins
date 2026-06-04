---
name: new-pr
description: Use when work on a branch is complete and should become a pull/merge request - runs every available code review (code-review --fix, Copilot, Codex, CodeRabbit) against the base branch, fixes the findings, verifies everything is committed, pushes, opens a PR or MR via gh or glab, then watches CI and CodeRabbit feedback in a fix-push loop until everything is green.
model: opus
---

# Turn the current branch into a reviewed PR/MR

Run the branch through every review layer available in the session, fix what
they find, then push and open a pull request (GitHub) or merge request
(GitLab).

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
   in step 6 takes the bare name.

3. **Abort with a clear message if:**
   - the current branch *is* the base branch (nothing to open a PR from), or
   - `git log "origin/$base"..HEAD --oneline` is empty and
     `git status --porcelain` is also empty (no work to submit).

## Review stages

Run the stages in order. After every stage that changed files, commit the
fixes before the next stage — so each reviewer sees the previous reviewer's
corrections, and reviewers that diff committed state don't miss them. Follow
the repository's commit message conventions.

### Stage 1 — built-in code review

Invoke the `code-review` skill with `--fix`. Its default scope — the branch
diff against the upstream/base plus the working tree — is exactly what should
be reviewed here; if the skill accepts a target argument, pass the base branch
so it diffs against `origin/$base`, but do not invent flags it does not have.
If no `code-review` skill is available in this session, review
`git diff "origin/$base"...HEAD` plus the working tree yourself with the same
goal — correctness bugs first — and apply the fixes.

### Stage 2 — GitHub Copilot review (only if installed)

Only when the `copilot:review` command is available in this session (from the
[copilot plugin](https://github.com/wagnersza/copilot-plugin-cc)):

- Run `/copilot:review --base "origin/$base" --wait`.
- The review is read-only: it returns findings (severity, file, line range,
  recommendation) but changes nothing. Judge each finding on its technical
  merits — verify it against the code before acting, skip findings that are
  wrong or out of scope (note why), and fix the justified ones.

### Stage 3 — OpenAI Codex review (only if installed)

Only when the `codex:review` command is available in this session (from the
[codex plugin](https://github.com/openai/codex-plugin-cc)):

- Run `/codex:review --base "origin/$base" --wait`.
- Like stage 2, the review is read-only and returns structured findings
  (severity, file, line range, recommendation). Apply the same judgement:
  verify findings against the code, fix the justified ones, skip and note
  the rest.

### Stage 4 — CodeRabbit review (only if installed)

Only when the `coderabbit:review` command is available in this session (from
the [coderabbit plugin](https://github.com/coderabbitai/claude-plugin)):

- Run `/coderabbit:review --base "origin/$base"`.
- Apply the same judgement as in stage 2: verify findings against the code,
  fix the justified ones, skip and note the rest.

Skip stages 2–4 silently when the corresponding plugin is missing — their
absence is not an error.

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

After the PR/MR exists, stay in a watch loop until the CI is green and no
review findings remain open. Cap the loop at 5 fix iterations — if it has not
converged by then, stop and hand the remaining findings to the user instead
of pushing in circles.

7. **Watch the CI:**

   - GitHub: `gh pr checks --watch`
   - GitLab: `glab ci status --live`

   On failure, pull the failing logs (GitHub: `gh run view <run-id>
   --log-failed`; GitLab: `glab ci trace <job>` for the failing job), analyze
   the cause, fix it autonomously, commit, push — then watch again.

8. **Check for CodeRabbit findings on the PR/MR.** When the repository has
   the CodeRabbit app, it comments a few minutes after each push — give it a
   short grace period before concluding there is nothing:

   - If the coderabbit plugin is installed, prefer its `autofix` skill: it
     fetches the bot's review comments from the PR, applies fixes, commits,
     and pushes.
   - Otherwise fetch the unresolved bot comments yourself (GitHub:
     `gh api repos/{owner}/{repo}/pulls/<nr>/comments`; GitLab:
     `glab api "projects/:id/merge_requests/<iid>/discussions"` — filter for
     the `coderabbitai` author). Judge each finding as in stages 2–4: fix the
     justified ones, and reply to the ones you skip with a short reason
     instead of silently ignoring them. Commit and push the fixes.
   - No CodeRabbit app on the repository → no comments appear; skip silently.

9. **Loop.** Every push restarts the CI and triggers a CodeRabbit re-review;
   repeat steps 7–8 until both are quiet in the same iteration: CI green and
   no unresolved findings.

10. **Report:** the PR/MR URL, which review stages ran, how many findings
    were fixed or skipped per stage, and how many monitor iterations it took.
