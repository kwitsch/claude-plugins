# branch-management

Branch lifecycle skills backed by dedicated subagents. `new-branch` starts
work on a fresh branch cut from the updated default branch; `new-pr` turns a
finished branch into a reviewed, pushed PR/MR and watches it until green.

## Skills

| Skill | What it does |
|---|---|
| `new-branch` | Dispatches the `branch-agent` to switch to the default branch, pull, and create `<type>/<slug>`; refreshes the context-mode index (declared plugin dependency). |
| `new-pr` | Runs `code-review --fix`, then codex/copilot/coderabbit CLI reviews in parallel reviewer agents, applies verified fixes via the `review-fixer`, pushes, opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. Each review source can be disabled per project (see [Configuration](#configuration)). |

Skills no longer pin a `model:` — each unit of work runs in a dedicated agent
with its own model.

## Agents

| Agent | Model | Role |
|---|---|---|
| `branch-agent` | haiku | git mechanics of cutting a new branch |
| `codex-reviewer` | haiku | runs `scripts/codex-review.sh`, returns findings JSON |
| `copilot-reviewer` | haiku | runs `scripts/copilot-review.sh`, returns findings JSON |
| `coderabbit-reviewer` | haiku | runs `scripts/coderabbit-review.sh`, returns findings JSON |
| `review-fixer` | opus | verifies findings against the code, fixes, commits |
| `ci-monitor` | sonnet | read-only: watches CI (bounded by `CI_WATCH_TIMEOUT`, default 1800 s / 30 min), collects CodeRabbit PR threads |

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
repository root — the git toplevel):

```markdown
---
reviews:
  claude: true
  codex: true
  copilot: true
  coderabbit: true
---
```

- Fail-open: a missing file, missing key or invalid value keeps the
  review enabled — only an explicit `false` disables a source.
- Write bare values — a trailing inline comment (`false # note`) is not
  recognized and leaves the source enabled.
- `claude` gates stage 1 (`code-review --fix`);
  `codex`/`copilot`/`coderabbit` gate the stage-2 CLI reviews.
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
toggles (`<tool>=true|false`, one line each, fail-open defaults) from the
settings file described under Configuration. Without an argument it reads
`<git-toplevel>/.claude/branch-management.local.md` (outside a repo:
`$PWD/.claude/…`). Exit codes: `0` always · `1` usage error.
