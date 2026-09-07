# CLAUDE.md — coding-toolbox skill: fresh-pr

## Skill design (`fresh-pr`)

Self-contained PR-lifecycle skill: inline synchronous git/gh/glab
orchestration (`skills/fresh-pr/SKILL.md`, same idiom as `fresh-branch`) for
commit→rebase→push→PR-open-or-refresh, then a Task*-ledger-tracked goal loop
dispatching two plugin-local agents — `agents/ci-watcher.md` (read-only,
polls `bin/ci-watch.sh`, collects open CodeRabbit threads plus any attached
"Prompt for AI Agents" text) and `agents/pr-fixer.md` (applies justified
fixes, commits, never pushes, always annotates skipped findings in code) —
until CI is green and, only if CodeRabbit ever comments, its threads are
resolved. No cross-plugin dependency, no code-review-rounds step (not
requested). Existing-PR handling (create if
none / update title+body via `gh api PATCH` — never `gh pr edit`, known to
silently fail on this repo's Projects-classic board — or `glab mr update` if
open / reopen-then-update if closed / report-and-stop if merged). Both agents' optional context-mode acceleration was removed
2026-07-05 (repo-wide context-mode phase-out, starting here); `rtk` was
evaluated as a replacement and found to give no measurable
benefit for most commands either agent runs (`gh run view --log-failed`,
`gh pr checks`, `gh api …` all came back byte-identical or only
cosmetically reformatted when diffed raw-vs-`rtk`; `glab`'s `ci
trace`/`api` paths remain unverified — no `glab` in the dev environment)
— **correction, 2026-07-16**: `ci-watcher`'s own bare `gh run list
--branch <branch>` call (used to find a failing run's id; distinct from
`ci-watch.sh`'s `--json`/`--jq` poll queries, which stay byte-identical
under `rtk`) does measurably benefit — 65–81% size reduction across
several real repos, run ids and pass/fail status both preserved — the
2026-07-05 test of this exact command was evidently stale (rtk version
drift since). `fresh-pr` now detects `rtk` once (`rtk_available` in its
git-context block, alongside `current_branch`/`detected_base`/etc.) and
passes it to `ci-watcher`, which prefixes only this one call with `rtk`
when available; the other command classes above remain unaccelerated.
`ci-watcher`'s `bin/ci-watch.sh` invocation is
now prefixed with `TMPDIR="<scratchpad path>"` (resolved once by
`fresh-pr`, `mktemp -d` fallback when no scratchpad is available) so the
script's own internal `mktemp` call lands in the session's scratch space
rather than shared system `/tmp` — its `TMPDIR` behavior is unchanged,
`mktemp` already prefers `$TMPDIR` when set (the script separately gained
an explicit `mktemp`-failure guard, exit `64`, documented in
`agents/ci-watcher.md`). 2026-07-25: the rebase script (previously embedded
at step 5) is now a standalone `rebase.sh` + colocated `rebase.reference.md`,
per `.claude/rules/script-authoring.md`'s updated convention; the
git-context `!`-block (the `## Git context` section) stays inline — extracting it is gated on
verifying `${CLAUDE_SKILL_DIR}` substitution inside a `!`-injection block
specifically, not yet proven in this repo. 2026-08-01: `finish-pr` became
this script's second consumer (its own new rebase-freshness-check step) —
see that skill's own CLAUDE.md section for why it stayed here rather than
moving to the plugin's `bin/`.

**CodeRabbit-readiness false-green (fixed 2026-07-11).** `ci-watcher`'s step 3
used to decide "CodeRabbit is done posting review feedback" from a blind,
LLM-judged grace period ("at most 3 polls over ~3 minutes, stop early on the
first poll that finds comments"). This false-green pattern was observed on
this plugin's own `ci-watcher` on PR #129 and again on PR #130 in the same
session, both times only caught because the
orchestrating session independently re-verified via `gh pr checks` + a
background poll of the CodeRabbit check + a GraphQL unresolved-thread count —
a workaround, not a fix. Root cause: the poll-count heuristic never looked
at the one signal that actually answers the question — CodeRabbit's own
GitHub check conclusion (deliberately excluded from step 1's real-CI verdict,
so it can't be reused there for a different purpose without a dedicated
query). Fixed at the source: `bin/ci-watch.sh` gained a second query mode,
`--coderabbit-check` (github only; usage-errors for gitlab, which has no
per-check concept for CodeRabbit — it posts only as MR discussions there),
reusing the same poll/timeout/rg_or_grep machinery to wait for that
excluded check's OWN bucket to leave `pending` — bounded by its own
`CI_WATCH_CODERABBIT_TIMEOUT` (default 600s), separate from the main
`CI_WATCH_TIMEOUT` (1800s) since it answers a different, generally
faster-resolving question. `ci-watcher.md` step 3 now calls this before its
(now single, non-looping) thread fetch; every exit code (concluded, not
found after 3 confirmations, or bounded-timeout-while-still-pending) proceeds
to the fetch regardless — the call only changes what gets noted in the
report, never whether CodeRabbit feedback is looked for.
