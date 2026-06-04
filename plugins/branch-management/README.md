# branch-management

Branch lifecycle skills backed by dedicated subagents. `new-branch` starts
work on a fresh branch cut from the updated default branch; `new-pr` turns a
finished branch into a reviewed, pushed PR/MR and watches it until green.

## Skills

| Skill | What it does |
|---|---|
| `new-branch` | Dispatches the `branch-agent` to switch to the default branch, pull, and create `<type>/<slug>`; refreshes the context-mode index when that plugin is installed. |
| `new-pr` | Runs `code-review --fix`, then codex/copilot/coderabbit CLI reviews in parallel reviewer agents, applies verified fixes via the `review-fixer`, pushes, opens the PR/MR via `gh`/`glab`, and loops `ci-monitor` → `review-fixer` until CI is green and no findings remain. |

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
| `ci-monitor` | sonnet | read-only: watches CI, collects CodeRabbit PR comments |

When the context-mode plugin is installed, reviewer agents execute their
script through `ctx_execute`, keeping raw review output out of the
conversation context.

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
