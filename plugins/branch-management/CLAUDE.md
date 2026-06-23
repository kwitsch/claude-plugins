# CLAUDE.md — branch-management

Orchestrator skills (`new-pr`, `review-branch`) dispatch six subagents; `new-branch` cuts the branch inline (no subagent).

| Concern | Rule |
|---|---|
| **Models** | haiku = CLI reviewers; sonnet = ci-monitor; opus = claude-reviewer, review-fixer |
| **Tools** | each agent declares least-privilege allowlist; both context-mode MCP wildcard spellings (server name differs per install) |
| **Colors** | unique per scope; same color OK across scopes (agents never co-run); white/default banned. Scope: review (claude-reviewer, coderabbit-reviewer, codex-reviewer, copilot-reviewer, review-fixer, ci-monitor) |
| **Skills** | declare `allowed-tools` pre-approvals + `argument-hint`; no `model:` key |

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
  `context: fork`; forked skill is subagent, cannot dispatch reviewer
  subagents); reads
  `review_claude/codex/copilot/coderabbit` toggles + `review_max_rounds`
  (default 3); quota read inline at startup via a `!` dynamic-context
  injection block over `$HOME/.claude/branch-management/quota/*.quota`;
  base-divergence check for coderabbit; dispatches enabled
  reviewers parallel (`claude-reviewer`, CLI reviewers); aggregates + dedupes findings with cross-round skip list
  (fixer echoes per-finding ids); findings → `review-fixer` + next round;
  converges when fixer commits nothing; stops before push when round
  $max_rounds still red; retries once when zero `ok` reviewers; records quota
  hits inline (rate-limit regex → write a 1-hour `.quota` window). User-invocable
  directly (e.g. `/review-branch --rounds 5`).
- `skills/configure-branch-management`: user-invocable interactive
  configurator; detects `.git`/`.claude` in cwd to offer project-scope
  choices (falls back to user scope when absent); reads current
  `pluginConfigs["branch-management@*"].options` from selected settings
  file, presents two thematic `AskUserQuestion` dialogs (reviewers+rounds,
  CI), validates numeric inputs with up to 3 re-asks,
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
- Script exit-code contract: 0 ran · 2 CLI missing (skip silent) ·
  3 not logged in (skip + report login cmd) · 4 run failed (skip +
  report). Review runs wrapped in `timeout -k 10 "${REVIEW_TIMEOUT:-600}"`.
  codex + coderabbit reviews are inlined into their reviewer agents; only
  `bin/copilot-review.sh` survives as a standalone script.
  The new-branch worktree self-rebase always exits 0 with a `REBASE_RESULT=`
  line (`rebased` / `skipped_dirty` / `conflict` / `failed`+`DETAIL`);
  state-mutating, so always native Bash.
  `ci-watch.sh <github|gitlab> <nr|branch>`: 0 green · 1 red · 2 deadline ·
  64 usage/environment (CLI missing/too old); green/red from check CONTENT
  (gh exits 1 fail / 8 pending with data), coderabbit-named checks
  excluded, no-checks/no-pipeline green after 3 consecutive answers,
  gitlab `skipped`/`manual` green (+note), per-call `timeout` guard,
  cadence via `CI_WATCH_INTERVAL`.
- CLI specifics: codex no headless review subcommand → `codex exec
  --sandbox read-only` with diff prompt; copilot no auth-status
  command → login heuristic (token env, non-empty `loggedInUsers` in
  COPILOT_HOME config.json, or gh `user:` in `hosts.yml` — copilot falls
  back to gh credential store, gh default secure storage keeps no
  `oauth_token` line; bare `~/.copilot` created on first launch without
  login) + auth-error sniffing. Copilot run hardened read-only on three
  layers (copilot no `--sandbox` like codex): `--deny-
  tool write`; allowlist
  of read-only git subcommands only (`shell(git:*)` would also match write
  subcommands like `git commit`, copilot approves per-subcommand); `bin/git-shim`
  (`git` facade prepended to copilot PATH, refuses `--output`/`-O` flag family
  which per-subcommand allowlist cannot express — `git diff --output=PATH`
  otherwise writes arbitrary file, verified against CLI 1.0.60). coderabbit
  auth/review exit codes uncontractual → output heuristics (`logged
  in|authenticated` positive, negative-first), `cr` (coderabbit CLI) alias supported.

## Conventions
- Feature toggles follow repo-wide `userConfig` rule
  (`plugins/CLAUDE.md`). Wire new toggle: read as
  `${user_config.KEY}` in consuming skill, add to README
  option table + this file, update manifest tests in
  `test/branch-management/test.bats` (assert exact sorted key
  list + count).
- Sub-skill (`review-branch`) runs INLINE — NOT `context: fork`.
  Forked skill is itself subagent, subagents have no Agent tool, so forked
  sub-skill cannot dispatch agents it relies on; inline keeps them at
  depth 0 so dispatches become visible depth-1 subagents. They resolve own
  toggles via `${user_config.*}` interpolation; parent skills pass only resolved
  values (e.g. `--base "$base"`, `--commit`), never re-pass toggle values.
- **Subagent tracking (cross-skill invariant).** Every dispatcher skill
  (`review-branch`, `new-pr`) reconciles its async
  Agent dispatches via a Task* ledger before advancing — `TaskCreate` per dispatch
  (`metadata.dispatch_id` = Agent `task_id`), `TaskUpdate`→`completed` on each
  `<task-notification>`, `TaskList` gate before aggregating/deciding/reporting,
  `TaskStop` escape for a stuck dispatch. Severity is asymmetric: a missed finish
  in `review-branch` drops findings → false `DONE` → unreviewed push (real bug).
  Always-on (no toggle). The
  Task* tools resolve at depth 0 where these skills run; a subagent-scoped
  `ToolSearch` falsely reports them absent — see `.claude/rules/subagent-tracking.md`.
- `configure-branch-management` writes delta-only: only keys differing
  from plugin.json defaults in settings; keys equal to defaults omitted or
  removed. When adding toggle, ensure its default in plugin.json reflects
  desired clean-state value — configurator uses plugin.json defaults as
  authoritative baseline.
- **Why the script-running agents stay subagents.** The CLI reviewer agents
  (`copilot`/`codex`/`coderabbit`) and `ci-monitor` keep their subagent dispatch
  even though each runs a script: they parse **free-form review/CI prose →
  structured JSON findings** (model work) and isolate **large raw output**
  (>100 KB, auto-indexed) from the orchestrator's context. A subagent that only
  runs a script with small structured output does NOT — those are inline scripts.

## Tests
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/branch-management/
```
`test/branch-management/test.bats` covers the surviving standalone scripts —
the codex + coderabbit reviews are inlined into their agents
(no bats; validated by dev-time self-test per the script-authoring rule).
`bin/copilot-review.sh` is run with stub CLIs on an isolated `PATH` (missing →
2, no login → 3, ok → passthrough, hang → timeout → 4, usage errors). Copilot
login heuristic tested across matrix (token env, recorded `loggedInUsers`,
`COPILOT_HOME` override, gh keyring vs inline-token vs logged-out
`hosts.yml`, `GH_CONFIG_DIR`; bare dir / first-launch / empty-array all →
3), `copilot-review.sh` asserted hardened read-only (no write
subcommand allowlisted). `bin/git-shim` direct unit tests
(read-only passthrough; `--output`/`-o`/`-O`/`--output-directory` refused;
unset real-git → 127). `bin/clean-branches.sh` covered against a throwaway
bare-remote + clone (prune fetch, upstream/local merged + gone deletion,
exact-name default-branch exclusion, uncommitted-file listing).
The review-branch rate-limit regex is extracted live from
`review-branch/SKILL.md` and run against the old quota corpus (positives:
rate limit / free tier quota / reviews/hour / HTTP 429; negatives: bare
"disk quota", 429 outside an HTTP context).
Plus plugin.json `userConfig` manifest checks (eight boolean toggles +
numeric `ci_watch_timeout` + numeric `review_max_rounds`, boolean defaults
all `true`, timeout default `1800`, rounds default `3`,
titles + descriptions, version declared only in plugin.json —
marketplace entry carries none — and no top-level `dependencies` key). `ci-watch.sh`
polling (coderabbit exclusion, pending→done transitions, timeout, no-checks
grace, gitlab status heuristics).