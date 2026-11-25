# taskflow

Spec-driven design & delivery pipeline for Claude Code, packaged as a plugin. `/taskflow:build-task` owns the whole pipeline as seven single-phase Workflow scripts shipped inside the skill — the design pipeline (explore, design, spec) and the delivery pipeline (plan, wave-parallel implement (isolated worktrees + per-wave merge for multi-task waves), combined review with fix application, ship). `/taskflow:changes-audit` (`skills/changes-audit/`) runs the same combined review standalone over a branch diff — no plan/spec/ship — then optionally applies the findings (`--fix` auto-applies all, otherwise an `AskUserQuestion` multi-select applies your picks).

## Install

```text
/plugin install taskflow@kwitsch-plugins
```

Requires Claude Code v2.1.154+ (dynamic workflows). On Pro plans, enable Dynamic workflows in `/config`.

## Skills

| Skill           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build-task`    | Orchestrator: creates and enters a `feature/<slug>` worktree, runs the design pipeline (explore → size → design → spec) and, after spec approval, the delivery pipeline (plan → implement → review → ship). `AskUserQuestion` checkpoints (open design questions, spec approval, escalated review fixes), final report. Sizes the task with jev-api's `request` tool (a `score` question) when available, otherwise by its own reasoning; the size picks the designer model, the planner model and the review level. Scripts and role files live in `skills/build-task/workflows/` and `roles/`. |
| `dispatch-task` | Hands the described task to a new worktree-isolated background session (`claude --worktree … --bg`, `sonnet`/`xhigh` by default, `--model=`/`--effort=` overridable) that runs `build-task` unattended.                                                                                                                                                                                                                                                                                                                                                                                          |
| `changes-audit` | Runs the `changes-review` workflow over the current branch's committed diff, then applies findings by re-dispatching `fix-applier`: `--fix` auto-applies every finding, otherwise an `AskUserQuestion` multi-select applies only your picks. Report-only lean (over-engineering) findings are never applied.                                                                                                                                                                                                                                                                                     |

## Workflows

build-task's seven scripts are plugin workflows in `workflows/` and run by name (`taskflow:build-task-<name>`), never by `scriptPath` (the Workflow tool rejects a `scriptPath` outside the session's readable directories, such as the plugin cache). Each leaves one session-temp file and returns only its path plus small status fields; the skill passes those absolute paths on to the later scripts, whose agents read them. Every script reads its inputs from the `args` global (structured object); a `decodeArgs` guard fails fast with `stage: 'args'` if a run is launched without input. Per-script usage references (parameters, exit contract, behavior) live beside the scripts. When the graphmind MCP server is connected and the checkout is registered (`graphmind which`), the design explorers and the planner use graphmind's code graph and project memory; otherwise they fall back to the built-in Explore agent / file search.

| Script                             | Purpose                                                                                                                                             | Output file             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `build-task-explore.workflow.js`   | Scout → read-only explorers → exploration reports.                                                                                                  | `explore-<slug>.md`     |
| `build-task-design.workflow.js`    | Draft design → design review → one revision round; pauses with open user questions (resumable).                                                     | `draft-<slug>.md`       |
| `build-task-spec.workflow.js`      | Write spec → spec review → one fix round.                                                                                                           | `spec-<slug>.md`        |
| `build-task-plan.workflow.js`      | Approved spec → implementation plan with machine-readable tasks → plan check → one revision round.                                                  | `plan-<slug>.md`        |
| `build-task-implement.workflow.js` | Wave-parallel implement (worktree + per-wave merge for multi-task waves; single-task waves commit directly), per-task review and fix.               | `implement-<slug>.json` |
| `build-task-review.workflow.js`    | Combined review over the branch diff (correctness angles + cleanup lenses, independently verified, plus a report-only lean pass) → fix application. | `review-<slug>.json`    |
| `build-task-ship.workflow.js`      | Push, PR/MR create-or-update, merge-state remediation, CI watch + bounded fix rounds. Not run when the user asked for no PR/MR.                     | `pr-body-<slug>.md`     |

The plugin-root `workflows/` directory holds one auto-discovered plugin workflow, invoked by name as `/taskflow:<name>`:

| Workflow         | Purpose                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes-review` | Standalone combined Review over a branch diff — correctness angles + cleanup lenses, independently verified, plus a report-only lean pass. No plan/spec/apply/ship. Invoked by the `changes-audit` skill (not `build-task`); returns verified `findings` + `ponytailReview`. |

## Agents

Static role prompts, dispatched via `agentType` by build-task's scripts and the `changes-review` workflow. The frontmatter `model` is a default; the scripts override it per run.

| Agent             | Model  | Role                                                                             |
| ----------------- | ------ | -------------------------------------------------------------------------------- |
| `review-finder`   | sonnet | Reviews one assigned lens (5 correctness angles + 5 cleanup lenses) over a diff. |
| `review-verifier` | sonnet | Independently verifies review candidates — CONFIRMED / PLAUSIBLE / REFUTED.      |
| `fix-applier`     | sonnet | Applies pre-verified review fixes by category, with a test-run safety gate.      |

The build-task roles are plugin agents too (the designer and planner model comes from the task size, the rest from the script):

| Agent             | Model   | Role                                                                                                                                             |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `designer`        | by size | Writes the design draft. `S` → sonnet, `M`/`L` → opus, `XL` → fable.                                                                             |
| `design-reviewer` | sonnet  | Read-only design review and open-question validation.                                                                                            |
| `planner`         | by size | Turns an approved spec into a dense, machine-executable implementation plan. Same size table as the designer.                                    |
| `worktree-merger` | haiku   | Merges approved task branches into the work branch in order, worktree cleanup (multi-task waves only).                                           |
| `pr-author`       | haiku   | Writes the PR/MR title and body from the implement and review result files and the repo template.                                                |
| `shipper`         | haiku   | Pushes, creates-or-updates the PR/MR, then auto-updates/auto-resolves its merge-state before CI monitoring. Never force-pushes or merges the PR. |
| `ci-monitor`      | haiku   | Read-only bounded CI poll and classification (`passed`/`failed`/`running`/`none`).                                                               |
| `ci-fixer`        | sonnet  | Classifies flaky/infra vs. code-caused vs. base-broken CI failures and fixes in scope.                                                           |

## Layout

```text
taskflow/
├── .claude-plugin/
│   └── plugin.json                        # name, version, metadata
├── workflows/                             # auto-discovered (default location)
│   ├── changes-review.workflow.js
│   ├── build-task-explore.workflow.js     # design pipeline 1/3
│   ├── build-task-design.workflow.js      # design pipeline 2/3
│   ├── build-task-spec.workflow.js        # design pipeline 3/3
│   ├── build-task-plan.workflow.js        # delivery pipeline 1/4
│   ├── build-task-implement.workflow.js   # delivery pipeline 2/4
│   ├── build-task-review.workflow.js      # delivery pipeline 3/4
│   └── build-task-ship.workflow.js        # delivery pipeline 4/4
├── agents/                                # auto-discovered (default location)
│   ├── review-finder.md    ├── review-verifier.md  ├── fix-applier.md
│   ├── designer.md         ├── design-reviewer.md  ├── planner.md
│   ├── worktree-merger.md  ├── pr-author.md        ├── shipper.md
│   └── ci-monitor.md       └── ci-fixer.md
├── bin/                                   # on PATH when the plugin is enabled
│   └── ship-ensure-mergeable.mjs           # Ship-phase PR/MR merge-state remediation
└── skills/
    ├── build-task/
    │   ├── SKILL.md                       # orchestrator
    │   └── workflows/                     # one <name>.md usage reference per script
    │       └── explore.md  design.md  spec.md  plan.md  implement.md  review.md  ship.md
    ├── dispatch-task/
    │   └── SKILL.md                       # background-session dispatch
    └── changes-audit/
        └── SKILL.md                       # standalone review + optional apply
```

## Usage

```text
/taskflow:build-task Add IrDA transport support to the kiosk app
```

The skill creates a `feature/<slug>` worktree and switches into it if needed (not with `--skip-branch-check`), runs the design pipeline (explore once, size the task, then design — looping through `AskUserQuestion` rounds while it exits `user_input_required` — then spec), presents the spec's key points for approval, then runs the delivery scripts (plan, implement, review, ship) and reports waves, findings, commits and the PR/MR. All intermediate files live in a `build-task/` subfolder of the session temp directory and are never committed.
