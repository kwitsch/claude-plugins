# branch-management

Branch lifecycle skills backed by dedicated subagents. `new-branch` starts
work on a fresh branch cut from the updated default branch; `new-pr` turns a
finished branch into a reviewed, pushed PR/MR and watches it until green.

## Skills

| Skill | What it does |
|---|---|
| `new-branch` | Dispatches the `branch-agent` to switch to the default branch, pull, and create `<type>/<slug>`; refreshes the context-mode index (declared plugin dependency). |
| `new-pr` | Runs iterative parallel review rounds (claude/codex/copilot/coderabbit reviewer agents, max 3), aggregates + dedupes the findings, applies verified fixes via the `review-fixer` between rounds (round 3 still red → stops before pushing), pushes, opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. Each review source can be disabled per project (see [Configuration](#configuration)). |

Skills no longer pin a `model:` — each unit of work runs in a dedicated agent
with its own model.

## Agents

| Agent | Model | Role |
|---|---|---|
| `branch-agent` | haiku | git mechanics of cutting a new branch |
| `claude-reviewer` | opus | reviews the branch diff itself (read-only), returns findings JSON |
| `codex-reviewer` | haiku | runs `scripts/codex-review.sh`, returns findings JSON |
| `copilot-reviewer` | haiku | runs `scripts/copilot-review.sh`, returns findings JSON |
| `coderabbit-reviewer` | haiku | runs `scripts/coderabbit-review.sh`, returns findings JSON |
| `review-fixer` | opus | verifies findings against the code, fixes, commits |
| `ci-monitor` | sonnet | read-only: watches CI via `scripts/ci-watch.sh` (CodeRabbit checks excluded, bounded by `CI_WATCH_TIMEOUT`, default 1800 s / 30 min), collects CodeRabbit PR threads |

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

Each review source of `new-pr` can be disabled per project in
`.claude/branch-management.local.md` (YAML frontmatter, file in the
repository root — the git toplevel; outside a git repo the current
directory is used). A user-level `~/.claude/branch-management.local.md`
with the same format supplies defaults across projects; the project file
wins per key:

```markdown
---
reviews:
  claude: true
  codex: true
  copilot: true
  coderabbit: true
---
```

- Fail-open: a review is only disabled by an explicit `false`
  (case-insensitive, quotes tolerated) in some layer — a missing or
  unreadable file, a file without frontmatter, a missing key or an
  invalid value never disables anything, and a broken layer is skipped
  without affecting the other.
- Write bare `true`/`false` values — a trailing inline comment
  (`false # note`) and YAML aliases like `no`/`off`/`0` are not
  recognized and count as neutral.
- Only direct children of the top-level block-style `reviews:` mapping
  count — nested sub-maps and flow-style (`reviews: {…}`) are ignored.
- Precedence per key: project file → user file → default (`true`). Only
  explicit `true`/`false` values assign — an invalid value is neutral and
  leaves the lower layer untouched; an explicit `copilot: true` in the
  project file re-enables a review the user file disabled.
- `claude` gates the `claude-reviewer`;
  `codex`/`copilot`/`coderabbit` gate their CLI reviewers.
- The toggles do not affect the monitor loop: CodeRabbit bot comments on
  the PR are still collected and processed.
- The file is read on every `new-pr` run — no restart needed. Add
  `.claude/*.local.md` to your `.gitignore`.

## Review CLIs (all optional)

| CLI | Login | Notes |
|---|---|---|
| [codex](https://developers.openai.com/codex/cli) | `codex login` | review runs headless via `codex exec --sandbox read-only` |
| [copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli) | `copilot login` or `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` | uses the documented `-p '/review …'` programmatic mode |
| [coderabbit](https://docs.coderabbit.ai/cli) | `coderabbit auth login` | uses `review --prompt-only --base`; free tier is rate-limited (3 reviews/h) |

A missing CLI is skipped silently. An installed CLI without a login is
skipped and called out in the final report together with the login command.

## Scripts

`scripts/<tool>-review.sh <base-branch>` — presence check → login check →
review run, in one bash block each. Exit codes: `0` review ran (stdout = raw
review output) · `2` CLI not installed · `3` not logged in · `4` run failed.
Review runs are wrapped in `timeout -k 10` (default 600 s, override with
`REVIEW_TIMEOUT`).

`scripts/review-settings.sh [settings-file]` — prints the four review
toggles (`<tool>=true|false`, one line each, fail-open defaults) merged
from the user-level and project-level settings files described under
Configuration (project wins per key). The argument overrides the
project-file path; without it the script reads
`<git-toplevel>/.claude/branch-management.local.md` (outside a repo:
`$PWD/.claude/…`). Exit codes: `0` always · `1` usage error.

`scripts/ci-watch.sh <github|gitlab> <pr-number|branch>` — polls one CI
round to completion and reflects only the real CI result: checks whose
name contains `coderabbit` are excluded, so a CodeRabbit app that never
reacts (not installed, rate-limited) can neither block the watch nor flip
the result. Green/red is derived from the check/pipeline CONTENT (gh
exits non-zero for failing and pending rounds alike); GitLab watches the
branch pipeline (merged-results pipelines are not targeted), `skipped`
counts green and a `manual` gate returns green with a note. Repos without
checks/pipeline count as green after three consecutive such answers.
Bounded by `CI_WATCH_TIMEOUT` (default 1800 s), poll cadence
`CI_WATCH_INTERVAL` (default 30 s), each CLI call hard-capped by
`timeout`. Exit codes: `0` green · `1` red · `2` deadline reached without
a conclusive result · `64` usage/environment error (bad arguments, CLI
missing or too old).
