---
name: review-branch
description: Run iterative parallel review rounds (claude/codex/copilot/coderabbit) with verified fixes between rounds, up to a configurable cap. Fully standalone — reads its own toggles and quota state. Called by new-pr; also user-invocable directly.
argument-hint: "[--base <branch>] [--rounds N]"
context: fork
model: sonnet
disable-model-invocation: true
allowed-tools: ["Agent", "Bash(git:*)", "Bash(echo:*)", "Bash(*/quota-state.sh*)"]
---

Run review rounds against the current branch.

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; printf "detected_base: %s\n" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"`

## Argument and config resolution

Parse `$ARGUMENTS`:
- `--base <branch>`: use the supplied value as `$base`. When absent,
  extract the value on the `detected_base:` line from the git context
  above. If still empty, abort and tell caller to supply `--base`.
- `--rounds N`: parse as a positive integer; use as `$max_rounds`.
  When absent, read `${user_config.review_max_rounds}`: parse as a
  positive integer; if empty, uninterpolated placeholder, or invalid,
  use `3`; clamp to minimum `1`.

Resolve toggles (fail-open — ONLY the literal value `false` disables):
- `$review_claude` = `${user_config.review_claude}`
- `$review_codex` = `${user_config.review_codex}`
- `$review_copilot` = `${user_config.review_copilot}`
- `$review_coderabbit` = `${user_config.review_coderabbit}`

Resolve `${CLAUDE_PLUGIN_ROOT}` to a concrete absolute path once
(e.g. `echo "${CLAUDE_PLUGIN_ROOT}"`). Store as `$plugin_root`.
Set `$quota_sh` = `<$plugin_root>/scripts/quota-state.sh`.

## Quota check

For each reviewer toggle that is enabled (not literally `false`), run:
```bash
"$quota_sh" check <tool>
```
where `<tool>` is `claude`, `codex`, `copilot`, or `coderabbit`.
- Exit 0: quota-limited; stdout is the reset epoch. Add reviewer to
  `quota_limited` set; treat identically to a `false` toggle for this
  run. Store the reset epoch for the final report.
- Exit 1: reviewer is clear.

The `check` command auto-deletes expired quota files.

## Base divergence check

After base is known, run:
```bash
git fetch origin "$base:$base" 2>/dev/null || true
```
If `git rev-parse --verify -q "$base"` and
`git rev-parse --verify -q "origin/$base"` differ, mark
`$coderabbit_diverged=true` (coderabbit diffs against the local base
and would review the wrong range). Exclude coderabbit from this run;
note "coderabbit skipped: local base diverged" in the report.

## Review loop

Repeat up to `$max_rounds` rounds:

**Dispatch** — send ALL enabled, non-quota-limited, non-diverged
reviewers in ONE message (parallel). If the dispatch set is empty,
skip all rounds and continue to the report. Resolve the script paths
once and reuse:

- `branch-management:claude-reviewer` — prompt contains: base branch `$base`.
- `branch-management:codex-reviewer` — prompt contains: base branch `$base`,
  absolute path `<$plugin_root>/scripts/codex-review.sh`.
- `branch-management:copilot-reviewer` — prompt contains: base branch `$base`,
  absolute path `<$plugin_root>/scripts/copilot-review.sh`.
- `branch-management:coderabbit-reviewer` — prompt contains: base branch `$base`,
  absolute path `<$plugin_root>/scripts/coderabbit-review.sh`.

Each agent returns `{tool, status, login_hint?, error?, findings}`.
Handle statuses: `missing` → skip silently; `no_auth` → skip, record
`login_hint`; `failed` → skip, record `error`. An unparsable reply
counts as `failed` with empty findings.

**Record quota hits** — for each reviewer with `status: "failed"`,
run `"$quota_sh" record <tool> "<error>"`. Exit 0 means rate-limited;
add to `quota_limited`, exclude from subsequent rounds, note in report.

**Aggregate and dedupe** — merge `findings` arrays from all `ok`
sources. Remove exact-duplicate `{file, line, message}` triples.
Carry forward a persistent `skip_list` of findings already handled by
the fixer across rounds.

**Decide:**
- **No reviewer returned `ok`** (every dispatched one came back
  `missing`/`no_auth`/`failed`): round reviewed nothing. Retry ONCE
  (retry does not count against the cap). If retry also yields no `ok`
  source, stop and tell the user that no review source succeeded.
- **No new findings** (after removing skip list): round is quiet.
  If the only `ok` review carried a `partial review` note, flag it
  prominently. Continue to report.
- **Findings remain and this was round `$max_rounds`**: do NOT dispatch
  fixer — a fix without a verification round would go out unreviewed.
  Stop; hand open findings to the user; list unpushed fix commits via
  `git log origin/$base..HEAD`.
- **Findings remain and rounds remain**: assign each finding a stable
  id (`F1`, `F2`, …). Dispatch `branch-management:review-fixer` ONCE
  with the full deduplicated findings JSON (including ids) and the base
  branch. It verifies, fixes justified findings, skips others with
  reasons, commits, and echoes each finding's `id` in its resolutions.
  Add skipped finding ids to `skip_list`. Increment round counter and
  continue loop.

## Report

Return a structured summary:
- Rounds run / cap
- Findings fixed (by round)
- Open findings (if any — hand to user)
- Disabled reviewers (via settings / quota-limited with reset epoch /
  diverged base)
- Degradation notes (partial review, Bash fallback, etc.)

Report DONE with summary, or BLOCKED if something prevents completion.
