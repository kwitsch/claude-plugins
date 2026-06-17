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
| `configure-branch-management` | Interactive configurator for all plugin options. Detects project context, presents thematic question groups (reviewers, CI monitoring, graphify, context-mode) with current values embedded, and writes only non-default values to the chosen settings scope. Requires `jq`. |
| `new-branch` | Switches to the default branch, pulls, and creates `<type>/<slug>` inline (synchronous git script, no subagent); then invokes the `init-branch` sub-skill to refresh the graphify output and context index (togglable via `graphify_branch_update` / `graphify_force_create` / `context_index`). |
| `init-branch` | Thin sub-skill (runs inline, not forked): refreshes the graphify knowledge-graph output (background Bash, commit:no) and the context index (direct ctx_index MCP call — cave-context preferred, falls back to context-mode) for the current branch, gated by `graphify_branch_update` / `context_index`. Called by `new-branch` after branch creation; also user-invocable directly. |
| `new-pr` | Commits pending work, invokes the `review-branch` sub-skill for iterative review rounds, runs a background Bash graphify refresh before pushing (commit gated by `graphify_pr_commit`, refresh togglable via `graphify_pr_update`), pushes, opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. Every stage — review sources, CI watch, CodeRabbit comment handling — can be toggled via plugin options (see [Configuration](#configuration)). |
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

## Optional acceleration: context-mode

branch-management has no required dependencies. When the
[context-mode](https://github.com/mksglu/context-mode) plugin is installed,
read-only script execution and heavy output processing — review runs, CI
logs, PR threads — are routed through its sandboxed
`ctx_execute`/`ctx_batch_execute`, keeping raw output out of the
conversation context.

- context-mode is entirely optional. When it is absent or disabled, every
  reviewer and monitor agent falls back to native tools (Bash/Read) and
  notes the fallback in its report — nothing blocks on it.
- State-mutating work (graphify refresh, branch cleanup) always runs on
  the native Bash tool, since the ctx sandbox discards filesystem and git
  writes.

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

The graphify refresh runs via an embedded background Bash script (it writes
`graphify-out/`, so it always runs on the native Bash tool rather than the
ctx sandbox).
