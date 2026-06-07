# branch-management

Branch lifecycle skills backed by dedicated subagents. `new-branch` starts
work on a fresh branch cut from the updated default branch; `new-pr` turns a
finished branch into a reviewed, pushed PR/MR and watches it until green.

## Skills

| Skill | What it does |
|---|---|
| `new-branch` | Dispatches the `branch-agent` to switch to the default branch, pull, and create `<type>/<slug>`; optionally refreshes the graphify output via the graphify-agent (togglable via `graphify_branch_update` / `graphify_force_create`); refreshes the context-mode index (declared plugin dependency, togglable via `context_index`). |
| `new-pr` | Runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer agents, max 3), aggregates + dedupes the findings, applies verified fixes via the `review-fixer` between rounds (round 3 still red → stops before pushing), optionally refreshes the graphify output and commits it separately (`graphify_pr_update` / `graphify_pr_commit`), pushes, opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. Every stage — review sources, CI watch, CodeRabbit comment handling — can be toggled via plugin options (see [Configuration](#configuration)). |

Skills no longer pin a `model:` — each unit of work runs in a dedicated agent
with its own model.

## Agents

| Agent | Model | Role |
|---|---|---|
| `branch-agent` | haiku | git mechanics of cutting a new branch |
| `graphify-agent` | haiku | runs `scripts/graphify-update.sh`, optionally commits `graphify-out` separately |
| `claude-reviewer` | opus | reviews the branch diff itself (read-only), returns findings JSON |
| `codex-reviewer` | haiku | runs `scripts/codex-review.sh`, returns findings JSON |
| `copilot-reviewer` | haiku | runs `scripts/copilot-review.sh`, returns findings JSON |
| `coderabbit-reviewer` | haiku | runs `scripts/coderabbit-review.sh`, returns findings JSON |
| `review-fixer` | opus | verifies findings against the code, fixes, commits |
| `ci-monitor` | sonnet | read-only: watches CI via `scripts/ci-watch.sh` (CodeRabbit checks excluded, bounded by `userConfig.ci_watch_timeout`, default 1800 s / 30 min), collects CodeRabbit PR threads |

## Dependencies

branch-management declares a cross-marketplace dependency on the
[context-mode](https://github.com/mksglu/context-mode) plugin
(`context-mode@context-mode`). All script execution and heavy output
processing — review runs, CI logs, PR threads — run through context-mode's
sandboxed `ctx_execute`/`ctx_batch_execute`, keeping raw output out of the
conversation context.

- Installing branch-management auto-installs context-mode once its
  marketplace is known to Claude Code:
  `/plugin marketplace add mksglu/context-mode`
  (installing context-mode manually first also satisfies the dependency).
- This marketplace allows the cross-marketplace resolution via
  `allowCrossMarketplaceDependenciesOn: ["context-mode"]` in
  `marketplace.json`.
- If the dependency is disabled or broken, the agents degrade to native
  tools (Bash/Read) and call out the degradation in their reports.
- `claude plugin uninstall branch-management --prune` removes the
  auto-installed dependency along with the plugin.

## Configuration

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
| `context_index` | `true` | `new-branch` skips the context-mode index refresh |
| `coderabbit_ci_comments` | `true` | the CI watch ignores CodeRabbit bot comments |
| `graphify_branch_update` | `true` | `new-branch` skips the graphify refresh |
| `graphify_force_create` | `false` | *(fail-closed — see below)* `new-branch` refresh runs even when `graphify-out/` is missing and creates the folder when set to `true` |
| `graphify_pr_update` | `true` | `new-pr` skips the graphify refresh before pushing |
| `graphify_pr_commit` | `true` | `new-pr` leaves refreshed graphify files uncommitted instead of committing them separately |
| `graphify_user_files` | `false` | *(fail-closed — see below)* the graphify refresh keeps human-only outputs (`graph.html`) instead of pruning them when set to `true` |

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
  Exceptions: `graphify_force_create` and `graphify_user_files` are
  fail-closed — they default to `false` and ONLY an explicit `true`
  enables them, so a missing or uninterpolated value can never create
  a folder or keep human-only files (the graphify output serves
  agents; `graph.html` is pruned after each refresh by default).
- The review toggles gate the review rounds only; CodeRabbit bot
  comments during the CI watch are controlled separately by
  `coderabbit_ci_comments`.
- All four review toggles `false` is allowed — `new-pr` then proceeds
  without any pre-push review and flags that in its report.

### Breaking change in v3.0.0

Configuration via `~/.claude/branch-management.local.md` and
`.claude/branch-management.local.md` is no longer read — migrate by
setting the equivalent options in the desired `settings.json` scope (see
above). Note the changed precedence: the old system was restrict-only
(any `false` in any layer won); the native scopes follow standard
precedence, so a project or local value overrides a user-level one.

## Review CLIs (all optional)

| CLI | Login | Notes |
|---|---|---|
| [codex](https://developers.openai.com/codex/cli) | `codex login` | review runs headless via `codex exec --sandbox read-only` |
| [copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli) | `copilot login`, gh CLI login, or `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` | uses the documented `-p '/review …'` programmatic mode, hardened read-only (write tool denied, read-only git allowlist) |
| [coderabbit](https://docs.coderabbit.ai/cli) | `coderabbit auth login` | uses `review --prompt-only --base`; free tier is rate-limited (3 reviews/h) |

A missing CLI is skipped silently. An installed CLI without a login is
skipped and called out in the final report together with the login command.

## Scripts

`scripts/<tool>-review.sh <base-branch>` — presence check → login check →
review run, in one bash block each. Exit codes: `0` review ran (stdout = raw
review output) · `2` CLI not installed · `3` not logged in · `4` run failed.
Review runs are wrapped in `timeout -k 10` (default 600 s, override with
`REVIEW_TIMEOUT`).

`scripts/ci-watch.sh <github|gitlab> <pr-number|branch>` — polls one CI
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

`scripts/graphify-update.sh [--force] [--keep-user-files]` — refreshes
the graphify output: resolves the repository root via git, then runs
`graphify update .` (wrapped in `timeout -k 10`, default
600 s, override with `GRAPHIFY_TIMEOUT`). Without `--force` it only runs
when `graphify-out/` already exists; `--force` creates the folder first.
The output serves agents: human-only artifacts (`graph.html`) are pruned
after the update unless `--keep-user-files` is given.
Exit codes: `0` update ran · `2` graphify CLI not installed · `4` run
failed · `5` `graphify-out/` missing without `--force`.
