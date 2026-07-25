# CLAUDE.md — branch-management

Orchestrator skills (`new-pr`, `review-branch`) dispatch subagents for review work; `new-branch` cuts the branch inline (no subagent).

| Concern    | Rule                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Models** | sonnet = ci-monitor; opus = review-fixer, claude-reviewer                                                                                            |
| **Tools**  | each agent declares least-privilege allowlist                                                                                                        |
| **Colors** | unique per scope; same color OK across scopes (agents never co-run); white/default banned. Scope: review (review-fixer, ci-monitor, claude-reviewer) |
| **Skills** | declare `allowed-tools` pre-approvals + `argument-hint`; no `model:` key                                                                             |

`ci-monitor`/`review-fixer`/`claude-reviewer`'s optional context-mode
acceleration was removed 2026-07-05 (continuing the repo-wide phase-out
started in `coding-toolbox`, PR #112). `rtk` was evaluated per command:
`ci-monitor`'s named commands (`gh run view --log-failed`, `gh run list`,
`gh pr checks` via `bin/ci-watch.sh`) matched coding-toolbox's already-tested
ones exactly — no measurable benefit; `glab`'s `ci trace`/`api` paths remain
unverified (no `glab` in the dev environment); `review-fixer` has no
concrete commands to evaluate. `claude-reviewer`'s `git diff
"origin/<base>"...HEAD` showed real compaction (28%+ smaller) but was
rejected: the agent's job is correctness-bug-hunting where stripped context
lines are a real risk, and the compaction is flag-fragile (adding `-U3` to
the identical command made `rtk` fall back to raw output). None of the
three agents carries an acceleration block today.

## Behavior

- `skills/new-branch`: decides the branch name (explicit arg verbatim, or
  `<type>/<slug>` slugged from a description), then cuts the branch inline via a
  single **synchronous** Bash script (clean-tree guard, `origin/HEAD` refresh,
  `--ff-only` pull, local+remote name-exists check, `git checkout -b`; structured
  exit codes 0/3/4/5/6/7 → success/dirty_tree/no_remote/git_op_failed/name_exists/worktree
  drive the user decisions). No subagent
  dispatch — the script is synchronous, so there is no async race against the
  shared working tree and no Task* ledger. **Linked-worktree path** (git-dir ≠
  git-common-dir): the default branch is checked out in the primary worktree so
  `git checkout <default>` fails; the script skips create+switch and keeps the
  current branch (exit 7), and new-branch runs an inline self-rebase script
  (synchronous native Bash: clean-tree guard → `git fetch origin <default>` →
  `git rebase origin/<default>`, `git rebase --abort` on conflict so the tree is
  never left half-rebased) to refresh the kept branch in place. The determined
  `<type>/<slug>` is then only PR title context, never applied as a branch name —
  keeping the current (session) branch is what lets a later new-pr register as
  the remote session's PR.
- `skills/review-branch`: standalone review sub-skill — runs INLINE (NOT
  `context: fork`; forked skill is a subagent and cannot dispatch Agent at depth 0);
  reads `review_level` (default `medium`) and `review_max_rounds` (default 3);
  each round dispatches `branch-management:claude-reviewer` with effort=`$review_level`
  and tracks it via the Task* ledger; on findings dispatches `branch-management:review-fixer`
  (also tracked) to fix and commit; repeats until DONE (no new findings) or BLOCKED
  (cap reached or no review source succeeded). No quota files.
  User-invocable directly (e.g. `/review-branch --rounds 5`).
- `skills/configure-branch-management`: user-invocable interactive
  configurator; detects `.git`/`.claude` in cwd to offer project-scope
  choices (falls back to user scope when absent); reads current
  `pluginConfigs["branch-management@*"].options` from selected settings
  file, presents two thematic `AskUserQuestion` dialogs (review level +
  rounds, CI), validates numeric inputs with up to 3 re-asks,
  writes delta-only options back (only keys differing from plugin.json defaults
  written; keys reverted to default deleted).
  Requires `jq`. Does NOT use `context: fork` or pin `model:`
  (user-facing interactive configurator).
- `skills/clean-branches`: user-invocable standalone skill (runs inline — NOT
  `context: fork`, no pinned model; `disable-model-invocation: true`); runs
  `bin/clean-branches.sh` which: (1) `git fetch --prune`;
  (2) when `gh auth status` or `glab auth status` succeeds — finds
  `origin/*` branches merged into the default branch (`origin/HEAD` symref,
  falls back to `git remote show origin`), deletes them via
  `git push origin --delete`, emits list (silent if none / no CLI access);
  (3) finds local branches with `[origin/*: gone]` tracking (excluding
  current branch), deletes them via `git branch -d`/`-D`, emits list
  (silent if none); (4) emits `git status --porcelain` files (silent if
  clean).
- `skills/new-pr`: preconditions (fetch, base detection, `origin/<base>` for
  all revisions, `linked_worktree` detection, feature toggles from `userConfig`
  interpolated as `${user_config.KEY}` — fail-open, only literal `false`
  disables); mandatory commit; invokes `skills/review-branch` with `--base
"$base"` (stops before push on open findings); pre-submit base rebase (step 8,
  gated by `rebase_before_pr`, fail-open): when `origin/$base` has commits not in
  HEAD, rebase the work branch onto it — synchronous native Bash, always exits 0
  with a `REBASE_RESULT=` line (`up_to_date`/`rebased`/`skipped_dirty`/`conflict`/
  `failed`); `conflict` aborts the rebase and STOPS before push, `rebased` forces
  the step-11 push; push
  (`git push -u origin "$branch"`; `--force-with-lease` when a linked worktree OR
  the step-8 rebase rewrote history — it both creates the ref when origin lacks it
  and safely force-updates a diverged ref, verified across both regimes) +
  `gh pr create`/`glab mr create`.
  **Auto-delete on merge** (gated by `delete_branch_on_merge`, fail-open): GitLab
  adds `--remove-source-branch` at create; GitHub has no per-PR flag, so after the
  PR opens new-pr ensures the repo-level `delete_branch_on_merge=true` via
  `gh api -X PATCH repos/{owner}/{repo}` (idempotent, soft-fail without admin —
  never aborts). **Session-PR
  linkage:** in a bridge/remote worktree the remote links the PR as the session
  PR only when the head ref is the session branch (`worktree-bridge-cse_<id>`), so
  new-pr opens from `$branch` as-is and never renames/re-pushes under another
  name; monitor
  loop (max 5, no-progress early exit): `ci-monitor` (read-only, gets platform +
  PR/MR reference + branch name + ci-watch.sh path + resolved `ci_watch_timeout`;
  CI watch via `bin/ci-watch.sh` — CodeRabbit checks excluded, bounded by
  `userConfig.ci_watch_timeout` / `CI_WATCH_TIMEOUT`, default 1800 s / 30 min)
  → `review-fixer` → push fixes, reply to + resolve skipped CodeRabbit threads,
  until CI green + no findings.
- Script exit-code contract for `bin/ci-watch.sh`:
  `ci-watch.sh <github|gitlab> <nr|branch>`: 0 green · 1 red · 2 deadline ·
  64 usage/environment (CLI missing/too old); green/red from check CONTENT
  (gh exits 1 fail / 8 pending with data), coderabbit-named checks
  excluded, no-checks/no-pipeline green after 3 consecutive answers,
  gitlab `skipped`/`manual` green (+note), per-call `timeout` guard,
  cadence via `CI_WATCH_INTERVAL`.

## Conventions

- Feature toggles follow repo-wide `userConfig` rule
  (`plugins/CLAUDE.md`). Wire new toggle: read as
  `${user_config.KEY}` in consuming skill, add to README
  option table + this file, update manifest tests in
  `test/branch-management/test.bats` (assert exact sorted key
  list + count).
- Sub-skill (`review-branch`) runs INLINE — NOT `context: fork`.
  Forked skill is itself subagent, subagents have no Skill tool at depth 0;
  inline keeps it at depth 0. Resolves own config via `${user_config.*}`
  interpolation; parent skills pass only resolved values (e.g. `--base "$base"`),
  never re-pass toggle values.
- `configure-branch-management` writes delta-only: only keys differing
  from plugin.json defaults in settings; keys equal to defaults omitted or
  removed. When adding toggle, ensure its default in plugin.json reflects
  desired clean-state value — configurator uses plugin.json defaults as
  authoritative baseline.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/branch-management/
```

`test/branch-management/test.bats` covers: `bin/clean-branches.sh`, `bin/ci-watch.sh`,
and the plugin.json `userConfig` manifest (7 keys: 4 boolean + 1 string
`review_level` + 2 numeric; sorted key list: `ci_monitor ci_watch_timeout
coderabbit_ci_comments delete_branch_on_merge rebase_before_pr review_level
review_max_rounds`; boolean defaults all `true`; `review_level` default `"medium"`;
numeric defaults 1800 and 3; titles + descriptions; version declared only in
plugin.json — marketplace entry carries none).
