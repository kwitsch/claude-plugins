# CLAUDE.md — coding-toolbox skill: fresh-pr

`SKILL.md` and `rebase.reference.md` (this dir) plus the plugin-root `agents/ci-watcher.md`, `agents/pr-fixer.md` and `bin/ci-watch.sh` are canonical for behavior; this file keeps only rationale and pitfalls.

## Skill design (`fresh-pr`)

Self-contained PR-lifecycle skill: inline synchronous git/gh/glab orchestration in `SKILL.md` (same idiom as `fresh-branch`) for commit→rebase→push→PR-open-or-refresh, then a Task\*-ledger goal loop over two plugin-local agents until CI is green and — only if CodeRabbit ever comments — its threads are resolved.

- No cross-plugin dependency.
- No code-review-rounds step — not requested.

### Agents

- `ci-watcher` is read-only: it polls `bin/ci-watch.sh` and collects open CodeRabbit threads plus any attached "Prompt for AI Agents" text.
- `pr-fixer` applies justified fixes and commits but never pushes, and always annotates skipped findings in code to prevent re-flagging.

### CodeRabbit readiness

- `ci-watcher` gets CodeRabbit readiness from `ci-watch.sh --coderabbit-check`, never from a poll-count/LLM-judged grace period.
  - Why: that grace period false-greened repeatedly (declared done while CodeRabbit was still posting); the one signal that answers the question is CodeRabbit's own GitHub check conclusion.
  - CodeRabbit's check stays excluded from step 1's real-CI verdict, so it needs this dedicated query.
- The mode is GitHub-only (CodeRabbit posts only as MR discussions on GitLab, so a gitlab call is a usage error).
- It waits for the check's own bucket to leave `pending`, bounded by `CI_WATCH_CODERABBIT_TIMEOUT`, separate from the main `CI_WATCH_TIMEOUT` (it answers a different, faster-resolving question).
- Every exit code (concluded, not found, timed out) proceeds to the single, non-looping thread fetch — the call only changes what the report notes, never whether CodeRabbit feedback is looked for.

### Existing-PR handling

- Open → update title/body via `gh api -X PATCH` (`glab mr update` on GitLab); closed → reopen then update; merged → report and stop; none → create.
- Never use `gh pr edit` — it silently fails on this repo's Projects-classic board; use `gh api` PATCH and verify.

### rtk

- `ci-watcher` prefixes only its bare `gh run list --branch <branch>` call with `rtk`, when fresh-pr's `rtk_available` git-context fact is set; other gh/glab calls are not rtk-prefixed.
- Detect `rtk` once in fresh-pr's git-context block and pass it down — do not make the agent re-probe it.

### Script layout

- `rebase.sh` + `rebase.reference.md` are standalone files at the skill root (per `.claude/rules/script-authoring.md`); `finish-pr` reuses them as a second consumer — see its `CLAUDE.md` for why they stay here, not in `bin/`.
- Keep the git-context `!`-block inline until `${CLAUDE_SKILL_DIR}` substitution inside a `!`-block is proven in this repo (see the Exception in `.claude/rules/script-authoring.md`).
