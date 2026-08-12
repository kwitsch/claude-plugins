# taskflow

Spec-driven design & delivery pipeline for Claude Code, packaged as a plugin. `/taskflow:build-task` orchestrates two dynamic workflows: `design-to-spec` (explore, draft, review, spec) and `spec-driven-delivery` (plan, wave-parallel implement in isolated worktrees, per-wave merge, combined review, fix application).

## Install

```
/plugin install taskflow@kwitsch-plugins
```

Requires Claude Code v2.1.154+ (dynamic workflows). On Pro plans, enable Dynamic workflows in `/config`.

## Skills

| Skill           | What it does                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-task`    | Orchestrator: branch handling, `AskUserQuestion` checkpoints (open design questions, spec approval, escalated review fixes), final report. Invokes the two workflows below. |
| `dispatch-task` | Hands the described task to a new worktree-isolated background session (`claude --worktree … --bg`, `sonnet`/`medium`) that runs `build-task` unattended.                   |

## Workflows

Both live in the plugin-root `workflows/` directory and are auto-discovered — no manifest field needed — so the skill invokes them by name, namespaced as `/taskflow:<name>`. Both read their inputs from the `args` global (structured object); a `decodeArgs` guard fails fast with `stage: 'args'` if a run is launched without input. Per-workflow usage references (parameters, exit contract, behavior) live in `skills/build-task/references/`.

| Workflow               | Purpose                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-to-spec`       | Explore → Draft design → Design review → Write spec → Spec review. Exits `complete` or `user_input_required` (resumable via draft file + answers).                                              |
| `spec-driven-delivery` | Plan → wave-parallel Implement (always isolated worktrees, per-wave merge by a dedicated merger agent) → combined Review → fix application → Ship (push, PR/MR, CI watch + bounded fix rounds). |

## Agents

Static role prompts (rules, lens catalog, verdict ladder, git procedures), dispatched by the workflows via `agentType`; models set in frontmatter.

| Agent             | Model           | Role                                                                                   |
| ----------------- | --------------- | -------------------------------------------------------------------------------------- |
| `designer`        | claude-opus-4-8 | Writes/revises the design draft — approach, trade-offs, decisions.                     |
| `design-reviewer` | sonnet          | Read-only: placeholders, consistency, scope, ambiguity, question validation.           |
| `planner`         | claude-opus-4-8 | Turns an approved spec into a dense, machine-executable implementation plan.           |
| `review-finder`   | sonnet          | Reviews one assigned lens (5 correctness angles + 5 cleanup lenses) over a diff.       |
| `review-verifier` | sonnet          | Independently verifies review candidates — CONFIRMED / PLAUSIBLE / REFUTED.            |
| `worktree-merger` | haiku           | Merges approved task branches into the work branch in order, worktree cleanup.         |
| `fix-applier`     | sonnet          | Applies pre-verified review fixes by category, with a test-run safety gate.            |
| `pr-author`       | sonnet          | Writes the PR/MR title and body from the pipeline summary and repo template.           |
| `shipper`         | haiku           | Pushes and creates-or-updates the PR/MR idempotently. Never force-pushes or merges.    |
| `ci-monitor`      | haiku           | Read-only bounded CI poll and classification (`passed`/`failed`/`running`/`none`).     |
| `ci-fixer`        | sonnet          | Classifies flaky/infra vs. code-caused vs. base-broken CI failures and fixes in scope. |

## Layout

```text
taskflow/
├── .claude-plugin/
│   └── plugin.json                        # name, version, metadata
├── workflows/                             # auto-discovered (default location)
│   ├── design-to-spec.workflow.js
│   └── spec-driven-delivery.workflow.js
├── agents/                                # auto-discovered (default location)
│   ├── planner.md          ├── designer.md         ├── design-reviewer.md
│   ├── review-finder.md    ├── review-verifier.md  ├── worktree-merger.md
│   ├── fix-applier.md      ├── pr-author.md        ├── shipper.md
│   ├── ci-monitor.md       └── ci-fixer.md
└── skills/
    ├── build-task/
    │   ├── SKILL.md                       # orchestrator
    │   └── references/
    │       ├── design-to-spec.md          # parameters + exit contract
    │       └── spec-driven-delivery.md    # parameters + exit contract
    └── dispatch-task/
        └── SKILL.md                       # background-session dispatch
```

## Usage

```text
/taskflow:build-task Add IrDA transport support to the kiosk app
```

The skill cuts a work branch if needed, runs the design workflow (looping through `AskUserQuestion` rounds while it exits `user_input_required`), presents the spec's key points for approval, then runs the delivery workflow and reports waves, findings, and commits. All intermediate files live in a `build-task/` subfolder of the session temp directory and are never committed.
