# branch-management

Branch lifecycle skills. `new-branch` starts work on a fresh branch cut from
the updated default branch (inline); `new-pr` turns a finished branch into a
reviewed, pushed PR/MR — using the bundled `/code-review` skill for iterative
find-and-fix rounds — and watches it until green.

## Install

```
/plugin install branch-management@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `configure-branch-management` | Interactive configurator for all plugin options. Detects project context, presents thematic question groups (review level, CI monitoring) with current values embedded, and writes only non-default values to the chosen settings scope. Requires `jq`. |
| `new-branch` | Switches to the default branch, pulls, and creates `<type>/<slug>` inline (synchronous git script, no subagent). Inside a **linked worktree** (e.g. a bridge/remote session) it cannot switch to the default branch, so it keeps the current branch (exit 7) and runs an inline self-rebase script (fetch + rebase onto `origin/<default>`, aborts cleanly on conflict) — the slug becomes PR title context only, preserving the session branch the remote tracks. |
| `new-pr` | Commits pending work, invokes the `review-branch` sub-skill for iterative `/code-review --fix` rounds, rebases the work branch onto `origin/<base>` when the base gained new commits (togglable via `rebase_before_pr`; stops on conflict), pushes (`--force-with-lease` in a linked worktree), opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. In a bridge/remote worktree it opens the PR from the session branch as-is so the remote registers it as the session PR. CI watch and CodeRabbit comment handling can be toggled via plugin options (see [Configuration](#configuration)). |
| `review-branch` | Standalone review sub-skill (runs inline, not forked): each round invokes the bundled `/code-review` skill with `"$review_level --fix $base"`, detects working-tree changes, runs auto-detected tests, commits specific changed files, and repeats until no changes (DONE) or the round cap is reached (BLOCKED). Configurable via `review_level` and `review_max_rounds`. Invoked by `new-pr`; also user-invocable to review without opening a PR. |
| `branch-management:clean-branches` | Fetch latest, prune merged upstream branches (gh/glab), delete local branches whose upstream is gone, list uncommitted files. |

## Agents

| Agent | Model | Role |
|---|---|---|
| `review-fixer` | opus | verifies CI/CodeRabbit findings against the code, applies fixes, commits, resolves CodeRabbit threads |
| `ci-monitor` | sonnet | read-only: watches CI via `bin/ci-watch.sh` (CodeRabbit checks excluded, bounded by `userConfig.ci_watch_timeout`, default 1800 s / 30 min), collects open CodeRabbit PR threads |

## Configuration

Run `/configure-branch-management` for an interactive wizard that guides you through all options and writes the result automatically. Manual editing via `settings.json` is also supported using the table below.

Every plugin function is individually togglable via the plugin's
`userConfig` options. They can be set in `settings.json` under
`pluginConfigs["branch-management"].options`. Scope precedence is
the native settings order: `.claude/settings.local.json` (local) >
`.claude/settings.json` (project) > `~/.claude/settings.json` (user).

| Option | Default | Effect / Value |
|---|---|---|
| `review_level` | `"medium"` | Effort level for `/code-review`: `low` / `medium` / `high` / `xhigh` / `max` — passed to each review round |
| `ci_monitor` | `true` | `new-pr` ends after opening the PR/MR — no CI watch |
| `ci_watch_timeout` | `1800` | positive whole-number seconds for the CI watch deadline (`new-pr` passes this to the watch script; invalid/missing values fall back to `1800`) |
| `coderabbit_ci_comments` | `true` | the CI watch ignores CodeRabbit bot comments |
| `delete_branch_on_merge` | `true` | `new-pr` does not wire auto-delete-on-merge — the merged branch is left in place (GitHub repo `delete_branch_on_merge` untouched; GitLab MR keeps its source branch). When `true`, `new-pr` enables it: GitHub via `gh api` (idempotent, soft-fails without admin), GitLab via `--remove-source-branch` |
| `rebase_before_pr` | `true` | `new-pr` does not rebase before submitting — opens the PR/MR even if the base advanced. When `true`, after committing `new-pr` rebases the work branch onto `origin/<base>` if the base gained new commits (force-with-lease push; stops on conflict) |

Example (project scope, `.claude/settings.json`):

```json
{
  "pluginConfigs": {
    "branch-management": {
      "options": {
        "review_level": "high"
      }
    }
  }
}
```

- Fail-open: only an explicit `false` disables a boolean function — unset
  options fall back to their declared default. `review_level` falls back to
  `"medium"` when empty or invalid.

## Scripts

`bin/ci-watch.sh <github|gitlab> <pr-number|branch>` — polls one CI
round to completion and reflects only the real CI result: checks whose
name contains `coderabbit` are excluded, so a CodeRabbit app that never
reacts (not installed, rate-limited) can neither block the watch nor flip
the result. Green/red is derived from the check/pipeline CONTENT (gh
exits non-zero for failing and pending rounds alike); GitLab watches the
branch pipeline (merged-results pipelines are not targeted), `skipped`
counts green and a `manual` gate returns green with a note. Repos without
checks/pipeline count as green after three consecutive such answers.
Bounded by `userConfig.ci_watch_timeout` (default 1800 s; passed to the
script as `CI_WATCH_TIMEOUT`), poll cadence `CI_WATCH_INTERVAL` (default
30 s), each CLI call hard-capped by
`timeout`. Exit codes: `0` green · `1` red · `2` deadline reached without
a conclusive result · `64` usage/environment error (bad arguments, CLI
missing or too old).
