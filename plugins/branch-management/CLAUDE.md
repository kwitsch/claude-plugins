# CLAUDE.md — branch-management

Two thin orchestrator skills (`new-branch`, `new-pr`) dispatch eight dedicated agents. Model selection all in agent frontmatter (haiku = mechanics/CLI reviewers/graphify, sonnet = ci-monitor, opus = claude-reviewer + review-fixer). Each agent declares least-privilege `tools:` allowlist (both context-mode MCP wildcard spellings listed — server name differs per install; distinct `color` per agent); skills declare `allowed-tools` pre-approvals + `argument-hint`. Skills carry no `model:` key. context-mode (cross-marketplace dependency, declared in plugin.json, marketplace allowlisted via `allowCrossMarketplaceDependenciesOn`) runs scripts + heavy reads: agents bootstrap deferred ctx_* tools via ToolSearch, run scripts/logs/threads through `ctx_execute`/`ctx_batch_execute`, fall back to native tools only when dependency broken (degradation reported). Git writes + guaranteed-small outputs stay on Bash per context-mode whitelist.

## Behavior
- `skills/new-branch`: dispatches `agents/branch-agent` (clean-tree guard,
  `origin/HEAD` refresh, `--ff-only` pull, `<type>/<slug>` creation,
  structured abort codes for user decisions); then
  `agents/graphify-agent` (runs `scripts/graphify-update.sh`, commit:
  no), gated by `graphify_branch_update` (fail-open) with force from
  `graphify_force_create` and user_files from `graphify_user_files`
  (both FAIL-CLOSED: only literal `true` enables — placeholder must
  never create folder; graphify output serves agents, human-only
  `graph.html` pruned unless explicitly kept); then
  `context-mode:ctx-index` in main context, gated by
  `context_index` toggle.
- `skills/new-pr`: preconditions in skill (fetch, base detection,
  `origin/<base>` for all revisions, feature toggles from plugin.json
  `userConfig` interpolated as `${user_config.KEY}` into skill —
  fail-open, only literal `false` disables, uninterpolated placeholders
  count as enabled; review toggles gate reviewer dispatches, `ci_monitor`
  gates monitor loop, `coderabbit_ci_comments` gates CodeRabbit
  thread collection); mandatory commit, then iterative review rounds (max 3):
  all enabled reviewers in parallel — `claude-reviewer` reviews diff
  itself, CLI reviewers run `scripts/<tool>-review.sh <base>` through
  context-mode `ctx_execute` (Bash only as reported degradation), all
  return findings JSON; aggregation + dedupe in skill with cross-round
  skip list (fixer echoes per-finding ids); findings → one
  `review-fixer` pass + next round; fixer commits nothing → converged;
  round 3 still red → stop before pushing, hand findings to user;
  round with zero `ok` reviewers retries once, then stops; graphify
  refresh before push via `graphify-agent` (force: no, user_files from
  fail-closed `graphify_user_files`), gated by
  `graphify_pr_update`, separate `chore:` commit gated by
  `graphify_pr_commit` (off → changes stay uncommitted; commit
  re-check + standing review-fixer rule leave `graphify-out`
  alone); push + `gh pr
  create`/`glab mr create`; then monitor loop (max 5, no-progress
  early exit):
  `ci-monitor` (read-only analysis, gets platform + PR/MR reference + branch
  name + ci-watch.sh path + resolved `ci_watch_timeout`; CI watch via
  `scripts/ci-watch.sh` — CodeRabbit checks excluded so silent bot cannot
  block, bounded by `userConfig.ci_watch_timeout` / `CI_WATCH_TIMEOUT`,
  default 1800 s / 30 min) →
  `review-fixer` → push fixes, reply to + resolve skipped CodeRabbit threads,
  until CI green and no findings remain.
- Script exit-code contract: 0 ran · 2 CLI missing (skip silently) ·
  3 not logged in (skip + report login command) · 4 run failed (skip +
  report). Review runs wrapped in `timeout -k 10 "${REVIEW_TIMEOUT:-600}"`.
  `graphify-update.sh [--force] [--keep-user-files]`: 0 ran · 2 CLI
  missing · 4 run failed · 5 `graphify-out/` missing without `--force`;
  repo root via git, bounded by `GRAPHIFY_TIMEOUT` (default 600 s);
  prunes human-only `graph.html` after the update unless
  `--keep-user-files` (output serves agents).
  `ci-watch.sh <github|gitlab> <nr|branch>`: 0 green · 1 red · 2 deadline ·
  64 usage/environment (CLI missing/too old); green/red from check CONTENT
  (gh exits 1 fail / 8 pending with data), coderabbit-named checks
  excluded, no-checks/no-pipeline green after 3 consecutive answers,
  gitlab `skipped`/`manual` green (+note), per-call `timeout` guard,
  cadence via `CI_WATCH_INTERVAL`.
- CLI specifics: codex has no headless review subcommand → `codex exec
  --sandbox read-only` with diff prompt; copilot has no auth-status
  command → login heuristic (token env, non-empty `loggedInUsers` in
  COPILOT_HOME config.json, or gh `user:` in `hosts.yml` — copilot falls
  back to gh credential store, gh default secure storage keeps no
  `oauth_token` line; bare `~/.copilot` created on first launch without
  login) + auth-error sniffing of output. Copilot run hardened
  read-only on three layers (copilot has no `--sandbox` like codex): `--deny-
  tool write`; allowlist of only read-only git subcommands (`shell(git:*)`
  would also match write subcommands like `git commit`, copilot approves
  per-subcommand); and `scripts/git-shim` (`git` facade prepended to
  copilot PATH, refuses `--output`/`-O` flag family which per-subcommand
  allowlist cannot express — `git diff --output=PATH` otherwise
  writes arbitrary file, verified against CLI 1.0.60). coderabbit
  auth/review exit codes uncontractual → output heuristics (`logged
  in|authenticated` positive, negative-first), `cr` alias supported.

## Conventions
- Feature toggles follow repo-wide `userConfig` rule
  (`plugins/CLAUDE.md`). Wiring new one here: read as
  `${user_config.KEY}` in consuming skill, add to README
  option table + this file, update manifest tests in
  `test/branch-management/test.bats` (assert exact sorted key
  list + count).

## Tests
`test/branch-management/test.bats` covers three review scripts with
stub CLIs on isolated `PATH` (missing → 2, no login → 3, ok →
passthrough, hang → timeout → 4, usage errors). Copilot login heuristic
tested across matrix (token env, recorded `loggedInUsers`,
`COPILOT_HOME` override, gh keyring vs inline-token vs logged-out
`hosts.yml`, `GH_CONFIG_DIR`; bare dir / first-launch / empty-array all →
3), `copilot-review.sh` asserted hardened read-only (no write
subcommand allowlisted). `scripts/git-shim` has direct unit tests
(read-only passthrough; `--output`/`-o`/`-O`/`--output-directory` refused;
unset real-git → 127). `graphify-update.sh` covered with stub CLI +
throwaway git repo (missing CLI → 2, missing folder → 5, `--force`
creates it, repo-root resolution from subdirectories, failure/hang → 4,
`graph.html` pruned by default / kept with `--keep-user-files`).
Plus plugin.json `userConfig` manifest checks (twelve boolean toggles +
numeric `ci_watch_timeout`, boolean defaults all `true` except fail-closed
`graphify_force_create` + `graphify_user_files`, timeout default `1800`,
titles + descriptions, version declared only in plugin.json — marketplace
entry carries none) and
`ci-watch.sh` polling (coderabbit exclusion, pending→done transitions,
timeout, no-checks grace, gitlab status heuristics).