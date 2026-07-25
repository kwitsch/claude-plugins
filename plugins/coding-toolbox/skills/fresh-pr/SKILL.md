---
name: fresh-pr
description: Use when branch work should become a pull/merge request without a code-review-rounds step — commits pending work, rebases onto an updated base, pushes, opens or refreshes a PR/MR (GitHub and GitLab), then drives it to CI-green (and, if CodeRabbit participates, all its review threads resolved) via this plugin's own ci-watcher/pr-fixer agents. Self-contained — no dependency on branch-management.
argument-hint: "[--base <branch>]"
allowed-tools:
  [
    "Agent",
    "AskUserQuestion",
    "Bash(git:*)",
    "Bash(gh:*)",
    "Bash(glab:*)",
    "Bash(jq:*)",
    "Bash(bash:*)",
    "Bash(mktemp:*)",
    "ToolSearch",
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
    "TaskStop",
  ]
---

# Push work and open/refresh a PR/MR, then drive it to CI-green

Self-contained: commits pending work, rebases onto an updated base, pushes,
opens or refreshes a PR/MR via `gh`/`glab`, then dispatches this plugin's own
`ci-watcher` (read-only) and `pr-fixer` agents in a loop until CI is green
and — only if CodeRabbit ever comments — its review threads are resolved. No
dependency on `branch-management`; every script/agent used here lives in
`coding-toolbox`.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## Git context

<!-- coderabbit-skip: `git`/`pwd` here run inside a dynamic-context `!` block — load-time preprocessing executed before Claude sees the content, not a Claude tool call, so `allowed-tools` has no bearing on it (cc-reference claude-code-skills-reference.md, "Dynamic context injection": "runs the shell command BEFORE Claude sees content ... preprocessing, not a Claude action"). -->

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; wt=no; [ "$(git rev-parse --git-dir 2>/dev/null)" -ef "$(git rev-parse --git-common-dir 2>/dev/null)" ] || wt=yes; printf "current_branch: %s\ndetected_base: %s\nlinked_worktree: %s\nworktree_path: %s\nrtk_available: %s\n" "$(git branch --show-current)" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')" "$wt" "$(pwd)" "$(command -v rtk >/dev/null 2>&1 && echo yes || echo no)"`

## Preconditions

1. **Assert a named branch:** take `current_branch:` from the git context
   above; if empty (detached HEAD), abort and tell the user to check out a
   branch first. Note `linked_worktree:` (governs the push mode in step 6) and
   `worktree_path:` (passed verbatim to every `ci-watcher`/`pr-fixer` dispatch
   in the goal loop, step 9, so it can `cd` there first — a bridge/worktree
   session's subagents otherwise default to the primary repo root).

2. **Commit pending work.** Run `git status --porcelain`. If non-empty: review
   `git diff` / `git diff --stat`, stage the files that belong to this
   branch's work, and commit with a message that follows the repo's commit
   conventions (no `Co-Authored-By` trailer, no `Generated with` footer). If
   the changes clearly mix unrelated concerns (e.g. unrelated new top-level
   files/dirs with no obvious common purpose), stop and ask the user via
   `AskUserQuestion` instead of guessing what belongs together.

3. **Resolve base branch.** Check `$ARGUMENTS` for `--base <branch>`; if
   present, use it as `$base`. Otherwise use `detected_base:` from the git
   context. If still empty, ask the user. Refresh the local base ref — the
   commands below resolve `$base` locally, not against the remote-tracking
   ref:

   ```bash
   git fetch origin "$base:$base" 2>/dev/null || true
   ```

4. **Abort with a clear message if:**
   - the current branch _is_ `$base` (nothing to open a PR from), or
   - `git log "origin/$base"..HEAD --oneline` is empty (no commits to submit —
     step 2 already committed anything pending, so this means there is truly
     no work).

## Rebase and push

5. **Rebase onto the latest base if it moved.**
   1. Read `rebase.reference.md` for the exact parameter/outcome contract.
   2. Run `bash ${CLAUDE_SKILL_DIR}/rebase.sh "$base"` via the Bash tool
      (synchronous native Bash — git fetch + rebase are writes, never a
      sandboxed shell tool).

   Map the `REBASE_RESULT=` line per `rebase.reference.md`'s table:
   - `rebased` → history was rewritten; set a `rebased=yes` marker —
     step 6's push MUST then use `--force-with-lease`. Continue.
   - `conflict` → **Stop here** — do not push or touch the PR/MR; hand
     the conflict to the user to resolve manually.
   - `failed` → report `DETAIL` as a soft note and continue — the branch
     is still pushable, the PR just may sit behind `$base`.
   - `up_to_date` / `skipped_dirty` → continue (or, for `skipped_dirty`,
     commit/stash first and re-run this step).

6. **Push.**
   - `linked_worktree:` is `yes` OR step 5 reported `rebased=yes` →
     `git push --force-with-lease -u origin "$branch"`.
   - otherwise → `git push -u origin "$branch"`.

   `--force-with-lease` covers both regimes: it creates the ref when origin
   does not have it yet, and safely force-updates a diverged ref. Do NOT use a
   bare `--force`.

## Open or refresh the PR/MR

7. **Pick the tool** from the `origin` URL (`git remote get-url origin`):
   - GitHub (`github.com` or a GitHub Enterprise host) → `gh`.
   - GitLab (`gitlab.` or a self-managed GitLab host) → `glab`.
   - Neither anchor matches (custom-domain Enterprise/self-managed host): check
     `gh auth status --hostname <host>` and `glab auth status --hostname
<host>` — if exactly one knows the host, use that tool; otherwise ask the
     user.

   If the required CLI is missing or unauthenticated, stop and give the user
   the exact command to run themselves.

8. **Check for an existing PR/MR, then create/update/reopen/report:**

   - GitHub: `gh pr view "$branch" --json number,state,url,title,baseRefName 2>/dev/null`
     — empty output or a non-zero exit means none exists.
   - GitLab: `glab api "projects/:id/merge_requests?source_branch=$branch&state=all" 2>/dev/null | jq -c '.[0] // empty'`
     — empty output means none exists. When a GitLab MR is found, use `.iid`
     (per-project IID, not the global `.id`) as `$number` — every subsequent
     `glab mr update/reopen` call and the discussion-resolve endpoint in step
     9.4 require the IID.

   Both queries key on the head/source branch alone (not the base), so
   existing-PR/MR detection is symmetric across platforms — an existing PR/MR
   is found even when it currently targets a base other than the resolved
   `$base`. If the found PR/MR's base (GitHub `.baseRefName` / GitLab
   `.target_branch`) differs from `$base`, surface that to the user via
   `AskUserQuestion` before proceeding: the update path below rewrites only
   title/body, never the base, so it will neither silently retarget the PR/MR
   nor open a duplicate against `$base`.

   Derive a title from the branch's purpose and a body from
   `git log "origin/$base"..HEAD` (what changed and why) — both are reused by
   every branch below.

   - **None found →** create:
     - GitHub: `gh pr create --base "$base" --title "<title>" --body "<body>"`
     - GitLab: `glab mr create --target-branch "$base" --title "<title>" --description "<body>" --yes`

     After creating, capture the new identifier with a re-query (the goal
     loop in step 9 needs it immediately):
     - GitHub: `gh pr view "$branch" --json number --jq '.number'` → `$number`
     - GitLab: same `glab api "projects/:id/merge_requests?source_branch=$branch&target_branch=$base"` query, extract `.iid` → `$number`

   - **Found, GitHub state `OPEN` / GitLab state `opened` →** regenerate and
     update title/body:
     - GitHub: **never `gh pr edit`** — this repo has a known case where it
       silently fails (a Projects-classic board's GraphQL). Instead:
       `gh api -X PATCH "repos/{owner}/{repo}/pulls/$number" -f title="<title>" -f body="<body>"`,
       then verify it landed:
       `gh api "repos/{owner}/{repo}/pulls/$number" --jq '.title'` and compare
       to `<title>`.
     - GitLab: `glab mr update "$number" --title "<title>" --description "<body>"`.

   - **Found, GitHub state `CLOSED` / GitLab state `closed` (not merged) →**
     reopen, then update exactly as the "found, open" case above:
     - GitHub: `gh pr reopen "$number"`
     - GitLab: `glab mr reopen "$number"`

   - **Found, GitHub state `MERGED` / GitLab state `merged` →** report the
     PR/MR URL as already merged and **stop here** — do not enter the goal
     loop (CI green is moot for a merged PR/MR).

## Goal loop — CI green, CodeRabbit resolved

> **Subagent reconciliation gate.** Track every `ci-watcher`/`pr-fixer`
> dispatch so you never advance on a partial batch and never miss a finish.
> Load the ledger tools once (deferred; resolve at depth 0, where this skill
> runs): `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). On dispatch, `TaskCreate` an entry
> (`metadata.dispatch_id` = the Agent `task_id`), then `TaskUpdate` it to
> `in_progress`. On its `<task-notification>`, record the structured result and
> `TaskUpdate` → `completed`. Before deciding whether to loop again or report,
> `TaskList`; do not advance while the current iteration's dispatch is still
> `pending`/`in_progress`. Escape hatch: a genuinely stuck entry gets
> `TaskStop`, marked terminal with a soft-failure, then proceed. Never
> `TaskOutput` a dispatch_id (transcript overflow). If the CRUD ledger tools
> fail to load, fall back to holding each step until the dispatched agent's
> structured result is in hand.

9. **Loop, capped at 5 iterations; stop early if an iteration makes no
   progress** (no new commits from `pr-fixer` and unchanged `ci`/
   `review_findings` compared to the prior iteration):

   1. Dispatch `coding-toolbox:ci-watcher` with: the platform, the PR/MR
      reference (number for GitHub, IID for GitLab), the branch name, the
      resolved absolute path to `<plugin-root>/bin/ci-watch.sh` (resolve
      `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path via
      `echo "${CLAUDE_PLUGIN_ROOT}"` once, reuse it every iteration), the
      fixed timeout `1800`, `worktree_path` (from precondition 1 — the
      agent chains `cd "<worktree_path>" &&` into each cwd-dependent `gh`/`glab`
      command so they resolve against the correct `origin` remote, not the
      primary-repo root), and the session scratchpad directory absolute
      path — resolve it once from this skill's own system prompt (same
      resolve-once-reuse-every-iteration treatment as `${CLAUDE_PLUGIN_ROOT}`
      above); if none is available, run `mktemp -d -t fresh-pr-XXXXXX` once
      instead — check its exit status before reusing the printed path; on
      failure, report the error and stop before dispatching `ci-watcher`
      rather than continuing with an empty/invalid path — and reuse that
      directory for the rest of the run. On GitHub
      also resolve
      `owner`/`name` once via `gh repo view --json owner,name --jq '{owner: .owner.login, name: .name}'`
      (`owner` comes back as an object, not a bare string — extract `.login`)
      and pass them along. Also pass `rtk_available` (from the git-context
      block above). Track the dispatch via the ledger above; do not proceed until
      `{ci, failures, review_findings}` is in hand.
   2. **If `ci` is `green` and `review_findings` is empty:** the goal is met —
      exit the loop.
   3. **If every entry in `failures` is synthetic** (`job == "ci-watch"` — a
      watch deadline or environment error means CI itself never produced a
      verdict) **and `review_findings` is empty:** stop the loop immediately
      (there is no code fix for a synthetic failure) and report the synthetic
      cause; do not spend an iteration dispatching `pr-fixer`.
   4. **Otherwise** dispatch `coding-toolbox:pr-fixer` with `failures`,
      `review_findings`, `$base`, and `worktree_path` (from precondition 1).
      Track via the ledger; do not proceed until `{resolutions, commits}` is
      in hand.
      - If `commits` is non-empty, push it: `git push origin "$branch"` (no
        `--force` — `pr-fixer` never rewrites history, only adds commits).
      - For each `resolutions` entry with `"resolution": "skipped"` **and a
        non-empty `id`** (CI-failure-derived resolutions arrive without one —
        there is no CodeRabbit thread to resolve for those), reply on the
        CodeRabbit thread with its `reason` and resolve it, using its
        `id` (equals the original finding's `thread_id`):
        GitHub — GraphQL mutation
        `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<id>`;
        GitLab —
        `glab api -X PUT "projects/:id/merge_requests/$number/discussions/<id>" -f resolved=true`.
   5. Loop back to 9.1 — a push (from `commits`) restarts CI and CodeRabbit
      review, so the next iteration's `ci-watcher` observes fresh state.

## Report

10. **Report:** the PR/MR URL; whether it was created, updated, reopened, or
    already merged (stopped before the loop); the step-5 rebase outcome; the
    goal-loop iteration count and final `ci`/`review_findings` status — or,
    if it stopped early, why (round cap reached with findings remaining,
    no-progress, or a synthetic-only CI failure) plus anything the user needs
    to act on.
