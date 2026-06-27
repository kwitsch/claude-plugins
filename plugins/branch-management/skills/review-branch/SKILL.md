---
name: review-branch
description: Run iterative /code-review --fix rounds with test-and-commit between rounds, up to a configurable cap. Fully standalone — reads its own review_level and review_max_rounds. Called by new-pr; also user-invocable directly.
argument-hint: "[--base <branch>] [--rounds N]"
allowed-tools: ["Skill", "Bash(git:*)", "Bash(echo:*)", "Bash(date:*)", "Bash(printf:*)", "Bash(grep:*)", "Bash(jq:*)", "Bash(npm:*)", "Bash(make:*)", "Bash(timeout:*)", "Bash(bash:*)", "Bash(sed:*)"]
---

Run /code-review --fix review rounds against the current branch.

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

## Test auto-detection

Run ONCE before the first round; cache the result as `$test_cmd`.

```bash
toplevel="$(git rev-parse --show-toplevel)"
repo_basename="${toplevel##*/}"
if [ -d "test/$repo_basename" ]; then
  echo "test_cmd: BATS_LIB_PATH=/usr/lib/bats bats test/$repo_basename/"
elif jq -e '.scripts.test' package.json >/dev/null 2>&1; then
  echo "test_cmd: npm test"
elif grep -q '^test:' Makefile 2>/dev/null; then
  echo "test_cmd: make test"
else
  echo "test_cmd: "
fi
```

Empty `$test_cmd` → no tests (skip silently; note "no tests detected" in report).

## Review loop

Repeat up to `$max_rounds` rounds:

**Step 1 — Run /code-review:**

Invoke `Skill: code-review` with args `"$review_level --fix $base"`. The skill
reviews the branch diff against `$base` and applies findings inline to the working
tree.

**Step 2 — Detect changes:**

```bash
git diff --name-only HEAD
```

- Output empty → **DONE** (no fixes applied; converged clean). Stop the loop and
  continue to Report.
- Output non-empty → record the changed file list as `$changed_files`; continue.

**Step 3 — Run tests (if `$test_cmd` non-empty):**

```bash
timeout 120 bash -c "$test_cmd" 2>&1 | tail -30
```

Record exit code as `$test_exit`. A non-zero exit is reported but does NOT stop
the loop — the test result is a signal, not a gate.

**Step 4 — Commit:**

```bash
git add $changed_files
git commit -m "review-branch: code-review fixes (round N)"
```

Use the exact file list from Step 2 (never `git add -A` — avoids sweeping
untracked artifacts or `.env` files).

**Step 5 — Check cap:**

If this was round `$max_rounds` and Step 2 found changes → **BLOCKED**
(cap reached; last round's fixes are committed but no follow-up review was run).

## Report

Lead with a terminal-state token — exactly `DONE` or `BLOCKED` as the first token
of its first line — so the caller (`new-pr` step 6) can gate machine-readably.

- **DONE**: converged clean (a round returned no changes).
- **BLOCKED**: round cap reached with fixes still being applied (open findings
  possible); or no base could be resolved.

Follow with:
- Rounds run / cap
- Per round: whether /code-review made changes; test result (pass / fail / skipped)
- If BLOCKED: note last-round fixes are committed but unverified by a follow-up pass
- Test detection result (command used or "no tests detected")
