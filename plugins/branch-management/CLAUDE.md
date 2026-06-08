# CLAUDE.md — branch-management

Two thin orchestrator skills (`new-branch`, `new-pr`) dispatch eight dedicated agents. Model selection all in agent frontmatter (haiku = mechanics/CLI reviewers/graphify, sonnet = ci-monitor, opus = claude-reviewer + review-fixer). Each agent declares least-privilege `tools:` allowlist (both context-mode MCP wildcard spellings listed — server name differs per install; distinct `color` per agent); skills declare `allowed-tools` pre-approvals + `argument-hint`. Skills carry no `model:` key. context-mode (cross-marketplace dependency, declared in plugin.json, marketplace allowlisted via `allowCrossMarketplaceDependenciesOn`) runs scripts + heavy reads: agents bootstrap deferred ctx_* tools via ToolSearch, run scripts/logs/threads through `ctx_execute`/`ctx_batch_execute`, fall back to native tools only when dependency broken (degradation reported). Git writes + guaranteed-small outputs stay on Bash per context-mode whitelist.

## Behavior
- `skills/new-branch`: dispatches `agents/branch-agent` (clean-tree guard,
  `origin/HEAD` refresh, `--ff-only` pull, `<type>/<slug>` creation,
  structured abort codes for user decisions); then invokes
  `skills/graphify-update` sub-skill (`context: fork`, haiku), gated by
  `graphify_branch_update` (fail-open); then `context-mode:ctx-index` in
  main context, gated by `context_index` toggle.
- `skills/graphify-update`: thin sub-skill (`context: fork`, `model: haiku`,
  `effort: low`, `disable-model-invocation: true`); dispatches
  `agents/graphify-agent` (runs `scripts/graphify-update.sh`, commit: no
  unless `--commit` arg passed). `--force`/`--user-files` args fall back to
  `graphify_force_create`/`graphify_user_files` toggles (both FAIL-CLOSED:
  only literal `true` enables — placeholder must never create folder; graphify
  output serves agents, human-only `graph.html` pruned unless explicitly kept).
  User-invocable directly (e.g. `/graphify-update --commit`).
- `skills/review-branch`: standalone review sub-skill (`context: fork`,
  `model: sonnet`, `disable-model-invocation: true`); reads its own
  `review_claude/codex/copilot/coderabbit` toggles and `review_max_rounds`
  (default 3); runs quota check via `scripts/quota-state.sh check <tool>` at
  startup; performs base-divergence check for coderabbit; dispatches all
  enabled reviewers in parallel (`claude-reviewer`, CLI reviewers via
  `ctx_execute`); aggregates + dedupes findings with cross-round skip list
  (fixer echoes per-finding ids); findings → `review-fixer` + next round;
  converges when fixer commits nothing; stops before pushing when round
  $max_rounds still red; retries once when zero `ok` reviewers; records quota
  hits via `quota-state.sh record <tool>`. User-invocable directly (e.g.
  `/review-branch --rounds 5`).
- `skills/new-pr`: preconditions (fetch, base detection, `origin/<base>` for
  all revisions, feature toggles from `userConfig` interpolated as
  `${user_config.KEY}` — fail-open, only literal `false` disables); mandatory
  commit; invokes `skills/review-branch` sub-skill with `--base "$base"` (if
  review-branch stops with open findings, stops before pushing); graphify
  refresh before push via `skills/graphify-update` sub-skill (`--commit` when
  `graphify_pr_commit` not `false`), gated by `graphify_pr_update`; push +
  `gh pr create`/`glab mr create`; then monitor loop (max 5, no-progress early
  exit): `ci-monitor` (read-only analysis, gets platform + PR/MR reference +
  branch name + ci-watch.sh path + resolved `ci_watch_timeout`; CI watch via
  `scripts/ci-watch.sh` — CodeRabbit checks excluded so silent bot cannot
  block, bounded by `userConfig.ci_watch_timeout` / `CI_WATCH_TIMEOUT`,
  default 1800 s / 30 min) → `review-fixer` → push fixes, reply to + resolve
  skipped CodeRabbit threads, until CI green and no findings remain.
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
- Sub-skills (`graphify-update`, `review-branch`) use `context: fork` +
  `disable-model-invocation: true` — they receive no conversation history
  and must resolve all toggles themselves or via explicit args. Parent
  skills pass only resolved values (e.g. `--base "$base"`, `--commit`);
  they never re-pass toggle values.

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
numeric `ci_watch_timeout` + numeric `review_max_rounds`, boolean defaults
all `true` except fail-closed `graphify_force_create` +
`graphify_user_files`, timeout default `1800`, rounds default `3`,
titles + descriptions, version declared only in plugin.json — marketplace
entry carries none) and
`quota-state.sh` (check/record/format_time: blocked vs. clear, rate-limit
pattern matching, expiry cleanup, HH:MM formatting). And
`ci-watch.sh` polling (coderabbit exclusion, pending→done transitions,
timeout, no-checks grace, gitlab status heuristics).