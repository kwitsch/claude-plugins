# branch-management

Branch lifecycle skills. `new-branch` starts work on a fresh branch cut from
the updated default branch (inline); `new-pr` turns a finished branch into a
reviewed, pushed PR/MR — backed by reviewer and CI subagents — and watches it
until green.

## Install

```
/plugin install branch-management@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `configure-branch-management` | Interactive configurator for all plugin options. Detects project context, presents thematic question groups (reviewers, CI monitoring) with current values embedded, and writes only non-default values to the chosen settings scope. Requires `jq`. |
| `new-branch` | Switches to the default branch, pulls, and creates `<type>/<slug>` inline (synchronous git script, no subagent). Inside a **linked worktree** (e.g. a bridge/remote session) it cannot switch to the default branch, so it keeps the current branch (exit 7) and runs an inline self-rebase script (fetch + rebase onto `origin/<default>`, aborts cleanly on conflict) — the slug becomes PR title context only, preserving the session branch the remote tracks. |
| `new-pr` | Commits pending work, invokes the `review-branch` sub-skill for iterative review rounds, rebases the work branch onto `origin/<base>` when the base gained new commits (togglable via `rebase_before_pr`; stops on conflict), pushes (`--force-with-lease` in a linked worktree, which creates the ref when origin lacks it and safely force-updates it when the branch already exists on origin and was self-rebased), opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. In a bridge/remote worktree it opens the PR from the session branch as-is so the remote registers it as the session PR. Every stage — review sources, CI watch, CodeRabbit comment handling — can be toggled via plugin options (see [Configuration](#configuration)). |
| `review-branch` | Standalone review sub-skill (runs inline, not forked): runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer agents, configurable via `review_max_rounds`), aggregates + dedupes findings, applies verified fixes via `review-fixer` between rounds, tracks quota limits. Invoked by `new-pr`; also user-invocable to review without opening a PR. |
| `branch-management:clean-branches` | Fetch latest, prune merged upstream branches (gh/glab), delete local branches whose upstream is gone, list uncommitted files. |

Two dispatcher skills (`new-pr`, `review-branch`) reconcile their
async subagents via a Task* To-Do ledger (`TaskCreate`/`TaskList`/`TaskStop`) — no
dispatch's completion is missed and no skill advances on a partial batch.
See `.claude/rules/subagent-tracking.md`.

## Agents

| Agent | Model | Role |
|---|---|---|
| `claude-reviewer` | opus | reviews the branch diff itself (read-only), returns findings JSON |
| `codex-reviewer` | haiku | runs an inline codex review, returns findings JSON |
| `copilot-reviewer` | haiku | runs `bin/copilot-review.sh`, returns findings JSON |
| `coderabbit-reviewer` | haiku | runs an inline coderabbit review, returns findings JSON |
| `review-fixer` | opus | verifies findings against the code, fixes, commits |
| `ci-monitor` | sonnet | read-only: watches CI via `bin/ci-watch.sh` (CodeRabbit checks excluded, bounded by `userConfig.ci_watch_timeout`, default 1800 s / 30 min), collects CodeRabbit PR threads |

## Configuration

Run `/configure-branch-management` for an interactive wizard that guides you through all options and writes the result automatically. Manual editing via `settings.json` is also supported using the table below.

Every plugin function is individually togglable via the plugin's
`userConfig` options. Claude Code prompts for the values when the
plugin is enabled; they can also be set manually in `settings.json`
under `pluginConfigs["branch-management"].options`. Scope precedence is
the native settings order: `.claude/settings.local.json` (local) >
`.claude/settings.json` (project) > `~/.claude/settings.json` (user).

| Option | Default | Effect / Value |
|---|---|---|
| `review_claude` | `true` | skip the `claude-reviewer` in review rounds |
| `review_codex` | `true` | skip the `codex-reviewer` in review rounds |
| `review_copilot` | `true` | skip the `copilot-reviewer` in review rounds |
| `review_coderabbit` | `true` | skip the `coderabbit-reviewer` in review rounds |
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
        "review_coderabbit": false
      }
    }
  }
}
```

- Fail-open: only an explicit `false` disables a function — unset
  options fall back to their declared `default: true`.
- The review toggles gate the review rounds only; CodeRabbit bot
  comments during the CI watch are controlled separately by
  `coderabbit_ci_comments`.
- All four review toggles `false` is allowed — `new-pr` then proceeds
  without any pre-push review and flags that in its report.

## Review CLIs (all optional)

| CLI | Login | Notes |
|---|---|---|
| [codex](https://developers.openai.com/codex/cli) | `codex login` | review runs headless via `codex exec --sandbox read-only` |
| [copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli) | `copilot login`, gh CLI login, or `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` | uses the documented `-p '/review …'` programmatic mode, hardened read-only (write tool denied, read-only git allowlist) |
| [coderabbit](https://docs.coderabbit.ai/cli) | `coderabbit auth login` | uses `review --prompt-only --base`; free tier is rate-limited (3 reviews/h) |

A missing CLI is skipped silently. An installed CLI without a login is
skipped and called out in the final report together with the login command.

## Scripts

`bin/copilot-review.sh <base-branch>` — presence check → login check →
review run, in one bash block. Exit codes: `0` review ran (stdout = raw
review output) · `2` CLI not installed · `3` not logged in · `4` run failed.
The review run is wrapped in `timeout -k 10` (default 600 s, override with
`REVIEW_TIMEOUT`). The codex and coderabbit reviews are inlined into their
respective reviewer agents rather than shipped as `bin/` scripts.

`bin/git-shim/git` — a read-only git facade prepended to copilot's PATH
during a review run so even allowlisted read-only git subcommands cannot
write via the `--output`/`-O` flag family (refused with exit 13);
forwards every other invocation to the real git named in
`COPILOT_REVIEW_REAL_GIT` (exits 127 when that variable is unset).

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
