---
name: review-branch
description: Run iterative claude-reviewer + review-fixer rounds against the current branch, up to a configurable cap. Fully standalone — reads its own review_level and review_max_rounds. Called by new-pr; also user-invocable directly.
argument-hint: "[--base <branch>] [--rounds N]"
allowed-tools: ["Agent", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "ToolSearch", "Bash(git:*)", "Bash(echo:*)", "Bash(date:*)", "Bash(printf:*)", "Bash(grep:*)", "Bash(jq:*)", "Bash(npm:*)", "Bash(make:*)", "Bash(timeout:*)", "Bash(bash:*)", "Bash(sed:*)"]
---

Run claude-reviewer + review-fixer review rounds against the current branch.

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; printf "detected_base: %s\n" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"`

## Argument and config resolution

Parse `$ARGUMENTS`:
- `--base <branch>`: use the supplied value as `$base`. When absent, extract the
  value on the `detected_base:` line above. If still empty, abort and tell the
  caller to supply `--base`.
- `--rounds N`: parse as a positive integer; use as `$max_rounds`. If absent,
  non-numeric, or invalid, use `3`; clamp to minimum `1`.
  When absent, read `${user_config.review_max_rounds}`: parse as a positive integer;
  if empty, uninterpolated placeholder, or invalid, use `3`; clamp to minimum `1`.

Resolve `$review_level` from `${user_config.review_level}`:
- Valid values: `low`, `medium`, `high`, `xhigh`, `max`.
- If the value is empty, an uninterpolated `${user_config.…}` placeholder, or not
  in the valid list, fall back to `medium`.

`$review_level` maps directly to the claude-reviewer effort level (same token names).

## Subagent reconciliation gate

Track every async dispatch so you never advance on a partial batch and never miss a
result. Load the ledger tools once (deferred; resolve at depth 0, where this skill
runs — a subagent-scoped probe falsely reports these absent, do NOT skip the ledger
on that basis):
`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
(retry bare names). Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList)
fail to load, use the prose-count fallback.

For each Agent dispatch below:
1. `TaskCreate` one entry (`subject` = role, `metadata.dispatch_id` = its Agent
   `task_id`), then `TaskUpdate` to `in_progress`.
2. On each `<task-notification>`, match by `dispatch_id`, record the structured
   result, `TaskUpdate` → `completed`.
3. **Gate:** before aggregating or deciding, `TaskList`; if any batch entry is still
   `pending`/`in_progress`, do NOT advance — wait for the remaining notification.
4. Escape hatch only: if a still-`in_progress` entry is judged genuinely stuck,
   `TaskStop` its `dispatch_id`, mark terminal, record soft-failure, proceed. Never
   `TaskOutput` a dispatch_id (transcript overflow).

Prose-count fallback (CRUD tools genuinely absent): track dispatched count; do not
advance until that many structured results are in hand.

## Review loop

Maintain a persistent `skip_list` of finding IDs already handled by the fixer
across rounds (starts empty).

Repeat up to `$max_rounds` rounds:

**Dispatch claude-reviewer:**

Dispatch `branch-management:claude-reviewer` with: base branch `$base`, effort
level `$review_level`. Track with the ledger; do NOT advance until its
`<task-notification>` arrives and `TaskList` shows it completed.

The agent returns `{tool, status, login_hint?, error?, findings}`.

Handle status:
- `ok` → use `findings`.
- `missing` → skip silently; continue to the no-reviewer path below.
- `failed` / unparsable → skip, record error; continue to the no-reviewer path below.

**No-reviewer path:** If the reviewer did not return `ok`, retry ONCE (the retry
does not count against the cap). If the retry also fails, stop: report no review
source succeeded — **BLOCKED**.

**Aggregate and dedupe:** Merge `findings` from the `ok` result. Remove exact-
duplicate `{file, line, title}` triples. Remove any finding already in `skip_list`.

**Decide:**

- **No new findings** (empty after skip-list removal): converged clean. Continue to
  Report — **DONE**.
- **Findings remain and this was round `$max_rounds`**: do NOT dispatch fixer — a
  fix without a follow-up review round goes out unverified. Stop; hand open findings
  to the user. Continue to Report — **BLOCKED**.
- **Findings remain and rounds remain**: assign each finding a stable id (`F1`,
  `F2`, …). Dispatch `branch-management:review-fixer` ONCE with the full
  deduplicated findings JSON (including ids) and the base branch. Track this fixer
  dispatch as a one-entry batch in the ledger; `TaskList` and confirm it is
  `completed` before consuming its result. The fixer verifies, fixes justified
  findings, skips others with reasons, commits, and echoes each finding's id in its
  resolutions. Add skipped finding ids to `skip_list`. Increment round counter and
  continue loop.

## Report

Lead with a terminal-state token — exactly `DONE` or `BLOCKED` as the first token
of its first line — so the caller (`new-pr` step 6) can gate machine-readably.

- **DONE**: converged clean (a round returned no new findings).
- **BLOCKED**: round cap reached with open findings; or no review source succeeded
  after retry.

Follow with:
- Rounds run / cap
- Reviewer effort level used (`$review_level`)
- Per round: findings count; findings fixed by fixer; findings skipped (with reasons)
- If BLOCKED due to open findings: list them; note last-round fixer commits are
  committed but no follow-up review ran
- If BLOCKED due to no reviewer: error details
