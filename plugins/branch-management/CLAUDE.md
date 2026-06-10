# CLAUDE.md — branch-management

Two orchestrator skills (`new-branch`, `new-pr`) dispatch nine subagents.

| Concern | Rule |
|---|---|
| **Models** | haiku = branch-agent, graphify-agent, CLI reviewers; sonnet = ci-monitor; opus = claude-reviewer, review-fixer |
| **Tools** | each agent declares least-privilege allowlist; both context-mode MCP wildcard spellings (server name differs per install) |
| **Colors** | unique per scope; same color allowed across scopes (agents that never co-run); white/default banned. Scopes: new-branch (branch-agent, graphify-agent, ctx-index-agent); review (claude-reviewer, coderabbit-reviewer, codex-reviewer, copilot-reviewer, review-fixer, ci-monitor) |
| **Skills** | declare `allowed-tools` pre-approvals + `argument-hint`; no `model:` key |
| **context-mode** | cross-marketplace dep (declared in plugin.json, marketplace-allowlisted); agents bootstrap deferred ctx_* via ToolSearch; scripts/logs via `ctx_execute`/`ctx_batch_execute`; fall back to native on broken dep (reported). Git writes + short outputs stay on Bash |

## Behavior
- `skills/new-branch`: dispatches `agents/branch-agent` (clean-tree guard,
  `origin/HEAD` refresh, `--ff-only` pull, `<type>/<slug>` creation,
  structured abort codes for user decisions); then dispatches
  `agents/graphify-agent` + `agents/ctx-index-agent` parallel (gated
  by `graphify_branch_update` + `context_index` toggles, both fail-open).
- `skills/graphify-update`: thin sub-skill (`context: fork`, `model: haiku`,
  `effort: low`); dispatches
  `agents/graphify-agent` (runs `bin/graphify-update.sh`, commit: no
  unless `--commit` arg passed). `--force`/`--user-files` fall back to
  `graphify_force_create`/`graphify_user_files` toggles (both FAIL-CLOSED:
  only literal `true` enables — placeholder must never create folder; graphify
  output serves agents, human-only `graph.html` pruned unless explicitly kept).
  User-invocable directly (e.g. `/graphify-update --commit`).
- `skills/review-branch`: standalone review sub-skill (`context: fork`,
  `model: sonnet`); reads
  `review_claude/codex/copilot/coderabbit` toggles + `review_max_rounds`
  (default 3); quota check via `bin/quota-state.sh check <tool>` at
  startup; base-divergence check for coderabbit; dispatches enabled
  reviewers parallel (`claude-reviewer`, CLI reviewers via
  `ctx_execute`); aggregates + dedupes findings with cross-round skip list
  (fixer echoes per-finding ids); findings → `review-fixer` + next round;
  converges when fixer commits nothing; stops before push when round
  $max_rounds still red; retries once when zero `ok` reviewers; records quota
  hits via `quota-state.sh record <tool>`. User-invocable directly (e.g.
  `/review-branch --rounds 5`).
- `skills/configure-branch-management`: user-invocable interactive
  configurator; detects `.git`/`.claude` in cwd to offer project-scope
  choices (falls back to user scope when absent); reads current
  `pluginConfigs["branch-management@*"].options` from selected settings
  file, presents three thematic `AskUserQuestion` dialogs (reviewers+rounds,
  CI, graphify+context-mode), validates numeric inputs with up to 3 re-asks,
  writes delta-only options back (only keys differing from plugin.json defaults
  written; keys reverted to default deleted).
  Requires `jq`. Does NOT use `context: fork` or pin `model:` (user-facing,
  not sub-skill).
- `skills/new-pr`: preconditions (fetch, base detection, `origin/<base>` for
  all revisions, feature toggles from `userConfig` interpolated as
  `${user_config.KEY}` — fail-open, only literal `false` disables); mandatory
  commit; invokes `skills/review-branch` with `--base "$base"` (stops before
  push on open findings); graphify refresh before push via
  `skills/graphify-update` (`--commit` when `graphify_pr_commit` not `false`),
  gated by `graphify_pr_update`; push + `gh pr create`/`glab mr create`; monitor
  loop (max 5, no-progress early exit): `ci-monitor` (read-only, gets platform +
  PR/MR reference + branch name + ci-watch.sh path + resolved `ci_watch_timeout`;
  CI watch via `bin/ci-watch.sh` — CodeRabbit checks excluded, bounded by
  `userConfig.ci_watch_timeout` / `CI_WATCH_TIMEOUT`, default 1800 s / 30 min)
  → `review-fixer` → push fixes, reply to + resolve skipped CodeRabbit threads,
  until CI green + no findings.
- Script exit-code contract: 0 ran · 2 CLI missing (skip silent) ·
  3 not logged in (skip + report login cmd) · 4 run failed (skip +
  report). Review runs wrapped in `timeout -k 10 "${REVIEW_TIMEOUT:-600}"`.
  `graphify-update.sh [--force] [--keep-user-files]`: 0 ran · 2 CLI
  missing · 4 run failed · 5 `graphify-out/` missing without `--force`;
  repo root via git, bounded by `GRAPHIFY_TIMEOUT` (default 600 s);
  prunes human-only `graph.html` after update unless
  `--keep-user-files` (output serves agents).
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
- Sub-skills (`graphify-update`, `review-branch`) use `context: fork` —
  no conversation history, must resolve all toggles themselves or via
  explicit args. Parent skills pass only resolved values (e.g. `--base "$base"`,
  `--commit`); never re-pass toggle values.
- `configure-branch-management` writes delta-only: only keys differing
  from plugin.json defaults in settings; keys equal to defaults omitted or
  removed. When adding toggle, ensure its default in plugin.json reflects
  desired clean-state value — configurator uses plugin.json defaults as
  authoritative baseline.

## Tests
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/branch-management/
```
`test/branch-management/test.bats` covers three review scripts with
stub CLIs on isolated `PATH` (missing → 2, no login → 3, ok →
passthrough, hang → timeout → 4, usage errors). Copilot login heuristic
tested across matrix (token env, recorded `loggedInUsers`,
`COPILOT_HOME` override, gh keyring vs inline-token vs logged-out
`hosts.yml`, `GH_CONFIG_DIR`; bare dir / first-launch / empty-array all →
3), `copilot-review.sh` asserted hardened read-only (no write
subcommand allowlisted). `bin/git-shim` direct unit tests
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
entry carries none) + `quota-state.sh` (check/record/format_time: blocked vs. clear,
rate-limit pattern matching, expiry cleanup, HH:MM formatting). `ci-watch.sh`
polling (coderabbit exclusion, pending→done transitions, timeout, no-checks
grace, gitlab status heuristics).