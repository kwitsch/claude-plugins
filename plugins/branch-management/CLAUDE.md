# CLAUDE.md — branch-management

Two thin orchestrator skills (`new-branch`, `new-pr`) that dispatch six
dedicated agents; all model selection lives in the agent frontmatter
(haiku = mechanics/reviewers, sonnet = ci-monitor, opus = review-fixer).
Skills carry no `model:` key.

## Behavior
- `skills/new-branch`: dispatches `agents/branch-agent` (clean-tree guard,
  `origin/HEAD` refresh, `--ff-only` pull, `<type>/<slug>` creation,
  structured abort codes for user decisions); then optional
  `context-mode:ctx-index` in the main context.
- `skills/new-pr`: preconditions in the skill (fetch, base detection,
  `origin/<base>` for all revisions); stage 1 `code-review --fix` with a
  mandatory commit before stage 2; stage 2 the three reviewer agents in
  parallel, each running `scripts/<tool>-review.sh <base>` (via context-mode
  `ctx_execute` when available, Bash otherwise) and returning findings JSON;
  dedupe in the skill; one `review-fixer` pass; push + `gh pr create`/`glab
  mr create`; then a monitor loop (max 5, with no-progress early exit):
  `ci-monitor` (read-only analysis, gets platform + PR/MR reference + branch
  name; CI watch bounded by `CI_WATCH_TIMEOUT`, default 1800 s) →
  `review-fixer` → push fixes, reply to + resolve skipped CodeRabbit threads,
  until CI is green and no findings remain.
- Script exit-code contract: 0 ran · 2 CLI missing (skip silently) ·
  3 not logged in (skip + report login command) · 4 run failed (skip +
  report). Review runs wrapped in `timeout -k 10 "${REVIEW_TIMEOUT:-600}"`.
- CLI specifics: codex has no headless review subcommand → `codex exec
  --sandbox read-only` with the diff prompt; copilot has no auth-status
  command → token-env/`~/.copilot` heuristic + auth-error sniffing of the
  output; coderabbit auth/review exit codes are uncontractual → output
  heuristics (`logged in|authenticated` positive, negative-first), `cr`
  alias supported.

## Tests
`test/branch-management/test.bats` covers the three scripts with stub CLIs
on an isolated `PATH` (missing → 2, no login → 3, ok → passthrough, hang →
timeout → 4, usage errors). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/branch-management/`.
