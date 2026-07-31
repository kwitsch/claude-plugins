---
name: finish-pr
description: Use to finalize an existing PR/MR for the current branch before merge — aborts if none exists, marks a draft PR/MR ready for review, enables GitLab's "delete source branch on merge" when the upstream is GitLab and it isn't already on, and reconciles the PR/MR's title and description against the actual diff.
allowed-tools:
  ["AskUserQuestion", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)", "Bash(jq:*)"]
---

# Finalize an existing PR/MR before merge

Verifies a PR/MR already exists for the current branch (aborts if not —
opening one is `fresh-pr`'s job), then brings it the rest of the way to
merge-ready: undrafts it, turns on GitLab's delete-source-branch-on-merge
if it's off, and reconciles its title/description against the actual diff.
Never touches CI, reviews, or merges the PR/MR itself.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision
> from the user, it MUST present the question through the `AskUserQuestion`
> tool — never as plain prose that waits for a typed reply.

## Git context

!`git fetch origin >/dev/null 2>&1; printf "current_branch: %s\n" "$(git branch --show-current)"`

## Preconditions

1. **Assert a named branch:** take `current_branch:` from the git context
   above; if empty or the line itself is missing (detached HEAD, or
   `disableSkillShellExecution` replaced the block with `[shell command
execution disabled by policy]` — the `git fetch origin` above silently
   never ran either), abort and tell the user to check out a branch (and,
   for the policy case, run `git fetch origin` themselves) before
   retrying — nothing below can be trusted otherwise.

## Pick the tool

2. From the `origin` URL (`git remote get-url origin`):
   - GitHub (`github.com` or a GitHub Enterprise host) → `gh`.
   - GitLab (`gitlab.` or a self-managed GitLab host) → `glab`.
   - Neither anchor matches (custom-domain Enterprise/self-managed host):
     check `gh auth status --hostname <host>` and `glab auth status --hostname
<host>` — if exactly one knows the host, use that tool; otherwise ask
     the user via `AskUserQuestion`.

   If the required CLI is missing or unauthenticated, stop and give the
   user the exact command to run themselves.

## Find the PR/MR

3. **Look up the PR/MR for `$branch`:**
   - GitHub: `gh pr view "$branch" --json number,state,url,title,body,baseRefName,isDraft 2>/dev/null`
     — empty output or a non-zero exit means none exists.
   - GitLab: `glab api "projects/:id/merge_requests?source_branch=$branch&state=all" 2>/dev/null | jq -c '.[0] // empty'`
     — empty output means none exists. When found, use `.iid` (per-project
     IID, not the global `.id`) as `$number`; also capture `.state`,
     `.title`, `.description`, `.target_branch`, `.should_remove_source_branch`,
     `.force_remove_source_branch`, and `.draft` (fall back to
     `.work_in_progress` if `.draft` is absent).

   **No PR/MR found (either platform) → abort:** "No PR/MR found for branch
   `$branch` — nothing to finish. Run `fresh-pr` first to open one."

4. **State branch:**
   - GitHub `MERGED` / GitLab `merged` → report the PR/MR URL, "already merged
     — nothing to finish," **stop**.
   - GitHub `CLOSED` / GitLab `closed` → report the PR/MR URL, "closed (not merged)
     — nothing to finish; reopen via `fresh-pr` first if this branch should
     still land," **stop**.
   - GitHub `OPEN` / GitLab `opened` → continue to step 5.

## Undraft if needed

5. `isDraft` (GitHub) / `draft` or `work_in_progress` (GitLab) is `true`:
   - GitHub: `gh pr ready "$number"`
   - GitLab: `glab mr update "$number" --ready`

   Already not a draft → skip this step entirely (no call). Note "was
   draft, now ready" (or "already ready") for the final report.

## GitLab: enable delete-source-branch-on-merge

6. **Skip this step entirely on GitHub** — no per-PR equivalent exists
   (GitHub's "automatically delete head branches" is a repository
   setting, out of scope). On GitLab:
   - `force_remove_source_branch` is `true` → the project already forces
     deletion regardless of the per-MR flag; note "already on (forced by
     project setting)" and skip the call below.
   - Otherwise, `should_remove_source_branch` is `true` → already on;
     skip the call.
   - Otherwise (`false`, `null`, or absent — a real MR's own API response
     can return `should_remove_source_branch: null`) →
     `glab mr update "$number" --remove-source-branch`.

   **`--remove-source-branch` toggles the setting — it does not set it to
   a fixed value.** Only ever call it under the third bullet above (the
   setting is currently off); calling it when it's already effectively on
   would flip it back off.

## Reconcile title & description

7. Base = the found PR/MR's own `baseRefName` (GitHub) / `target_branch`
   (GitLab) — do not independently re-resolve it.
   1. `git log "origin/$base"..HEAD` — what changed and why (the
      git-context block's `git fetch origin` above keeps `origin/$base`
      current). Ref unresolvable or range empty → report that and **skip
      the rest of this step** — don't guess at a description from
      nothing.
   2. Compare the current title/`body` (GitHub) or `description` (GitLab)
      against that history. Already accurate and complete → leave it
      untouched, no update call.
   3. Missing, stale, or wrong → write a corrected title/description:
      preserve any still-accurate existing content (links, testing notes,
      context), fix or add only what's wrong or missing.
   4. Changed → apply, then verify:
      - GitHub: `gh api -X PATCH "repos/{owner}/{repo}/pulls/$number" -f title="<title>" -f body="<body>"`
        (never `gh pr edit` — known silent-fail on this repo's own
        Projects-classic board), then
        `gh api "repos/{owner}/{repo}/pulls/$number" --jq '.title'` and
        compare to `<title>`.
      - GitLab: `glab mr update "$number" --title "<title>" --description "<body>"`.

## Report

8. **Report:** the PR/MR URL; draft status before/after; GitLab
   delete-source-branch-on-merge status before/after (`n/a` on GitHub);
   whether title/description changed and why, or "already accurate."
