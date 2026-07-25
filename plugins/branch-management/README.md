# branch-management

Branch lifecycle skills. `new-branch` starts work on a fresh branch cut from
the updated default branch (inline); `new-pr` turns a finished branch into a
reviewed, pushed PR/MR — dispatching the `claude-reviewer` + `review-fixer`
agents for iterative find-and-fix rounds — and watches it until green.

## Install

```
/plugin install branch-management@kwitsch-plugins
```

## Skills

| Skill                              | What it does                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configure-branch-management`      | Interactive configurator for all plugin options. Detects project context, presents thematic question groups (review level, CI monitoring) with current values embedded, and writes only non-default values to the chosen settings scope. Requires `jq`.                                                                                                                 |
| `new-branch`                       | Switches to the default branch, pulls, and creates `<type>/<slug>`. Inside a linked worktree it instead rebases the current branch onto the default branch in place, since it can't switch away from it there.                                                                                                                                                          |
| `new-pr`                           | Commits pending work, runs `review-branch` for iterative review rounds, rebases onto `origin/<base>` if it advanced, pushes, and opens or refreshes the PR/MR (GitHub and GitLab). Then loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. Toggle CI watch and CodeRabbit handling via plugin options (see [Configuration](#configuration)). |
| `review-branch`                    | Each round dispatches the `claude-reviewer` agent against the branch diff, then — on findings — `review-fixer` to verify, apply justified fixes, and commit. Repeats until a round finds nothing new (DONE) or the round cap is hit with findings still open (BLOCKED). Invoked by `new-pr`; also user-invocable on its own.                                            |
| `branch-management:clean-branches` | Fetch latest, prune merged upstream branches (gh/glab), delete local branches whose upstream is gone, list uncommitted files.                                                                                                                                                                                                                                           |

## Agents

| Agent             | Model  | Role                                                                                                                                                                             |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-reviewer` | opus   | read-only: reviews the branch diff against the base branch (correctness bugs first) and returns structured findings as JSON                                                      |
| `review-fixer`    | opus   | verifies CI/CodeRabbit findings against the code, applies fixes, commits, resolves CodeRabbit threads                                                                            |
| `ci-monitor`      | sonnet | read-only: watches CI via `bin/ci-watch.sh` (CodeRabbit checks excluded, bounded by `userConfig.ci_watch_timeout`, default 1800 s / 30 min), collects open CodeRabbit PR threads |

## Configuration

Run `/configure-branch-management` for an interactive wizard that guides you through all options and writes the result automatically. Manual editing via `settings.json` is also supported using the table below.

Every plugin function is individually togglable via the plugin's
`userConfig` options. They can be set in `settings.json` under
`pluginConfigs["branch-management"].options`. Scope precedence is
the native settings order: `.claude/settings.local.json` (local) >
`.claude/settings.json` (project) > `~/.claude/settings.json` (user).

| Option                   | Default    | Effect / Value                                                                                                                                                                                |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review_level`           | `"medium"` | Effort level for the `claude-reviewer` agent: `low` / `medium` / `high` / `xhigh` / `max` — passed to each review round                                                                       |
| `ci_monitor`             | `true`     | Watch CI after opening the PR/MR; `false` makes `new-pr` end right after opening it                                                                                                           |
| `ci_watch_timeout`       | `1800`     | CI watch deadline in seconds; invalid or missing values fall back to `1800`                                                                                                                   |
| `coderabbit_ci_comments` | `true`     | Collect and address open CodeRabbit bot comments while watching CI; `false` ignores them                                                                                                      |
| `delete_branch_on_merge` | `true`     | Enable auto-delete of the branch on merge (GitHub via `gh api`, idempotent, soft-fails without admin; GitLab via `--remove-source-branch`); `false` leaves branch-deletion settings untouched |
| `rebase_before_pr`       | `true`     | Rebase the work branch onto `origin/<base>` before pushing, if the base gained new commits (force-with-lease push; stops on conflict); `false` skips this                                     |

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
