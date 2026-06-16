---
name: review-branch
description: Run iterative parallel review rounds (claude/codex/copilot/coderabbit) with verified fixes between rounds, up to a configurable cap. Fully standalone — reads its own toggles and quota state. Called by new-pr; also user-invocable directly.
argument-hint: "[--base <branch>] [--rounds N]"
allowed-tools: ["Agent", "Bash(git:*)", "Bash(echo:*)", "Bash(date:*)", "Bash(mkdir:*)", "Bash(printf:*)", "Bash(grep:*)", "ToolSearch", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]
---

Run review rounds against the current branch.

## Git context

!`git fetch origin >/dev/null 2>&1; git remote set-head origin --auto >/dev/null 2>&1; printf "detected_base: %s\n" "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"`

## Argument and config resolution

Parse `$ARGUMENTS`:
- `--base <branch>`: use the supplied value as `$base`. When absent,
  extract the value on the `detected_base:` line from the git context
  above. If still empty, abort and tell caller to supply `--base`.
- `--rounds N`: parse as a positive integer; use as `$max_rounds`;
  if empty, non-numeric, or invalid use `3`; clamp to minimum `1`
  (so `--rounds 0` / `--rounds -2` fall back to `1`).
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

## Quota (dynamic-context injection)

```!
now=$(date +%s); dir="$HOME/.claude/branch-management/quota"
for f in "$dir"/*.quota; do
  [ -e "$f" ] || continue
  tool=$(basename "$f" .quota); reset=$(cat "$f" 2>/dev/null)
  if [ -n "$reset" ] && [ "$now" -lt "$reset" ]; then
    printf 'QUOTA %s limited_until %s\n' "$tool" "$(date -d "@$reset" '+%H:%M' 2>/dev/null || date -r "$reset" '+%H:%M')"
  else
    rm -f "$f"
  fi
done
echo "QUOTA_END"
```

Treat any reviewer printed above as quota-limited for this run (exclude it; report
its reset time). Reviewers not listed are clear.

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
- `branch-management:codex-reviewer` — prompt contains: base branch `$base`.
- `branch-management:copilot-reviewer` — prompt contains: base branch `$base`,
  absolute path `<$plugin_root>/bin/copilot-review.sh`.
- `branch-management:coderabbit-reviewer` — prompt contains: base branch `$base`.

**Reconcile reviewers before aggregating (subagent gate).**

**Subagent reconciliation gate.** Track every async dispatch so you never advance
on a partial batch and never miss a reviewer's findings. Load the ledger tools once
(deferred; resolve at depth 0, where this skill runs — a subagent-scoped probe
falsely reports these absent, do NOT skip the ledger on that basis):
`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
(retry bare names). Only if nothing loads, use the prose-count fallback below.
1. On dispatch, `TaskCreate` one entry per reviewer actually dispatched this round
   (`subject` = reviewer tool name, `metadata` = `{ dispatch_id: <Agent task_id>,
   batch: "review-round-<N>" }`), then `TaskUpdate` it to `in_progress`.
2. On each `<task-notification>`, match by `dispatch_id`, record the reviewer's
   `{tool, status, login_hint?, error?, findings}`, `TaskUpdate` → `completed`
   (`missing`/`no_auth`/`failed` are terminal too).
3. **Gate:** do NOT proceed to "Record quota hits", "Aggregate and dedupe", or
   "Decide" — and never emit `DONE`/`BLOCKED` — until `TaskList` shows zero
   `review-round-<N>` entries still `pending`/`in_progress`. A missed reviewer must
   never be silently dropped from the aggregate.
4. Escape hatch only: if, when next awake, a still-`in_progress` reviewer is judged
   genuinely stuck, `TaskStop` its `dispatch_id`, mark it terminal
   (`metadata.outcome: "stopped"`), treat it as `failed` (empty findings), and
   proceed. Never `TaskOutput` a dispatch_id (transcript overflow).
Prose-count fallback (tools genuinely absent): track the dispatched reviewer count
explicitly; do not aggregate or decide until that many `{…}` replies are in hand.
See `.claude/rules/subagent-tracking.md`.

Each agent returns `{tool, status, login_hint?, error?, findings}`.
Handle statuses: `missing` → skip silently; `no_auth` → skip, record
`login_hint`; `failed` → skip, record `error`. An unparsable reply
counts as `failed` with empty findings.

**Record quota hits (inline).** For each reviewer that returned
`status: "failed"`, test its error against the rate-limit regex and, on a
match, write a 1-hour window:

```bash
err='<reviewer error text>'; tool='<tool>'
if printf '%s' "$err" | grep -qiE 'rate.?limit|(api|rate|usage|tier|account|plan|billing|monthly|daily)[ -]?quota|reviews/hour|\b(HTTP[ /]?429|status[ :]?429)\b|too many requests'; then
  mkdir -p "$HOME/.claude/branch-management/quota"
  echo $(( $(date +%s) + 3600 )) > "$HOME/.claude/branch-management/quota/$tool.quota"
fi
```

(This write is a trivial output-less one-liner — exempt from the routing
block.) On a match, add the reviewer to `quota_limited`, exclude it from
subsequent rounds, and note it in the report.

**Aggregate and dedupe** — merge `findings` arrays from all `ok`
sources. Remove exact-duplicate `{file, line, title}` triples.
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
  branch. Track this fixer dispatch as a one-entry batch (`TaskCreate`
  with `metadata.dispatch_id` = the fixer's Agent `task_id`,
  `in_progress`); `TaskList` and confirm it is `completed` before
  consuming its result, so the loop never advances on an un-returned
  fixer. It verifies, fixes justified findings, skips others with
  reasons, commits, and echoes each finding's `id` in its resolutions.
  Add skipped finding ids to `skip_list`. Increment round counter and
  continue loop.

## Report

Return a structured summary:
- Rounds run / cap
- Findings fixed (by round)
- Open findings (if any — hand to user)
- Disabled reviewers (via settings / quota-limited with reset time /
  diverged base) — emit the HH:MM reset time already produced by the
  quota injection block above; never surface the raw Unix timestamp
- Degradation notes (partial review, Bash fallback, etc.)

Lead that summary with a terminal-state token — exactly `DONE` or
`BLOCKED` as the first token of its first line, nothing else — so the
caller (new-pr step 6) can gate machine-readably without parsing prose.
Map every terminal path to one of these two tokens:

- **DONE** (safe to push):
  - converged clean — a round came back quiet with no open findings;
  - no reviewer enabled / dispatch set empty (all toggled off, all
    quota-limited, or all diverged) — nothing was reviewable, treated
    as pushable consistent with the all-disabled design.
  - A partial-review degradation still reports DONE — flag it
    prominently in the summary, but it does not block the push.
- **BLOCKED** (caller must NOT push):
  - round `$max_rounds` ended with open findings still red (the
    no-fixer-without-verification stop above);
  - no review source succeeded after the single retry.

Follow the token with the summary on subsequent lines.
