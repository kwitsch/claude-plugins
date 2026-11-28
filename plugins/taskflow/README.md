# taskflow

Spec-driven design & delivery pipeline for Claude Code, packaged as a plugin. `/taskflow:build-task` owns the whole pipeline: six single-phase Workflow scripts run the design pipeline (explore, design, spec) and the delivery pipeline (plan, wave-parallel implement (isolated worktrees + per-wave merge for multi-task waves), ship), and the `review-task` skill does the review between implement and ship. `/taskflow:review-task` (`skills/review-task/`) reviews and fixes the current branch on its own: it commits pending changes, then runs Claude Code's bundled `/simplify` and `/code-review <level> --fix` over the branch diff against its base, one commit per pass.

## Install

```text
/plugin install taskflow@kwitsch-plugins
```

Requires Claude Code v2.1.154+ (dynamic workflows). On Pro plans, enable Dynamic workflows in `/config`.

## Skills

| Skill           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-task`    | Orchestrator: creates and enters a `feature/<slug>` worktree, runs the design pipeline (explore → size → design → spec) and, after spec approval, the delivery pipeline (plan → implement → review → ship). Decision checkpoints (open design questions, intent confirmation, review fixes that reverse the spec) through `decide`; `--headless` lets the advisor or the `decider` agent answer them and passes the flag to `review-task`. Final report. Sizes the task with the plugin's `size-task` tool (jev-api's calibrated `choice` question, else a plain Opus call, else its own reasoning); the size picks the designer model, the planner model and the review level. The review step runs `review-task` with that size. Usage references for the scripts live in `skills/build-task/workflows/`. |
| `decide`        | Internal decision step of `build-task` and `review-task`: shows the context as bullets and asks via `AskUserQuestion`; with `--headless` the advisor tool decides, or the `decider` agent when the advisor is absent. Ends with a `DECISIONS:` line. Not for direct use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dispatch-task` | Hands the described task to a new worktree-isolated background session (`claude --worktree … --bg`, `sonnet`/`xhigh` by default, `--model=`/`--effort=` overridable) that runs `build-task` unattended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `review-task`   | Commits pending changes, then runs `/simplify` and `/code-review <level> --fix` over the current branch's diff against its base (default: `origin/HEAD`, else `main`), committing each pass's edits. `--size=S`, `M`, `L` or `XL` sets the level: `S` → `medium`, `M` → `high`, `L` → `xhigh`, `XL` → `max`; without it the branch is sized with the `size-task` tool. Refuses a detached HEAD and the base branch; never pushes. `--headless` routes any decision through `decide` without the user.                                                                                                                                                                                                                                                                                                       |

## Workflows

build-task's six scripts are plugin workflows in `workflows/` and run by name (`taskflow:build-task-<name>`), never by `scriptPath` (the Workflow tool rejects a `scriptPath` outside the session's readable directories, such as the plugin cache). Each leaves one session-temp file and returns only its path plus small status fields; the skill passes those absolute paths on to the later scripts, whose agents read them. Every script reads its inputs from the `args` global (structured object); a `decodeArgs` guard fails fast with `stage: 'args'` if a run is launched without input. Per-script usage references (parameters, exit contract, behavior) live beside the scripts. When the graphmind MCP server is connected and the checkout is registered (`graphmind which`), the design explorers and the planner use graphmind's code graph and project memory; otherwise they fall back to the built-in Explore agent / file search.

| Script                             | Purpose                                                                                                                               | Output file             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `build-task-explore.workflow.js`   | Scout → read-only explorers → exploration reports.                                                                                    | `explore-<slug>.md`     |
| `build-task-design.workflow.js`    | Draft design → design review → one revision round; pauses with open user questions (resumable).                                       | `draft-<slug>.md`       |
| `build-task-spec.workflow.js`      | Write spec → spec review → one fix round.                                                                                             | `spec-<slug>.md`        |
| `build-task-plan.workflow.js`      | Approved spec → implementation plan with machine-readable tasks → plan check → one revision round.                                    | `plan-<slug>.md`        |
| `build-task-implement.workflow.js` | Wave-parallel implement (worktree + per-wave merge for multi-task waves; single-task waves commit directly), per-task review and fix. | `implement-<slug>.json` |
| `build-task-ship.workflow.js`      | Push, PR/MR create-or-update, merge-state remediation, CI watch + bounded fix rounds. Not run when the user asked for no PR/MR.       | `pr-body-<slug>.md`     |

The review step between implement and ship is the `review-task` skill; build-task writes its result to `review-<slug>.json` for the PR/MR body.

## Tool

`mcp__taskflow__size-task` (deferred, registered by the plugin's hooks module) sizes a task as `S`, `M`, `L` or `XL` for `build-task` and `review-task`: the task text and subsystem lines go to jev-api's `request` tool when it is installed and, when that is unsure or missing, to a plain model call. Like every tool a plugin registers itself, it answers before Claude Code's permission check: there is no permission prompt and `ask` rules do not apply. A `permissions.deny` rule for `mcp__taskflow__size-task` removes it; `build-task` and `review-task` then size by their own reasoning.

## Agents

The plugin ships 11 agents: 10 build-task roles, dispatched via `agentType` by build-task's scripts (the designer and planner model comes from the task size, the rest from the script; the frontmatter `model` is only a default), and `decider`, started by the `decide` skill in headless mode. Besides the roles below, `spec-writer` writes the spec and `explore-scribe` writes the exploration file.

| Agent             | Model   | Role                                                                                                                                             |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `designer`        | by size | Writes the design draft. `S` → sonnet, `M`/`L` → opus, `XL` → fable.                                                                             |
| `design-reviewer` | sonnet  | Read-only design review and open-question validation.                                                                                            |
| `planner`         | by size | Turns an approved spec into a dense, machine-executable implementation plan. Same size table as the designer.                                    |
| `worktree-merger` | haiku   | Merges approved task branches into the work branch in order, worktree cleanup (multi-task waves only).                                           |
| `pr-author`       | haiku   | Writes the PR/MR title and body from the implement and review result files and the repo template.                                                |
| `shipper`         | haiku   | Pushes, creates-or-updates the PR/MR, then auto-updates/auto-resolves its merge-state before CI monitoring. Never force-pushes or merges the PR. |
| `ci-monitor`      | haiku   | Read-only bounded CI poll and classification (`passed`/`failed`/`running`/`none`).                                                               |
| `decider`         | opus    | Read-only headless decision maker for `decide` when the advisor tool is absent or unclear (`effort: high`).                                      |
| `ci-fixer`        | sonnet  | Classifies flaky/infra vs. code-caused vs. base-broken CI failures and fixes in scope.                                                           |

## Layout

```text
taskflow/
├── .claude-plugin/
│   └── plugin.json                        # name, version, metadata
├── workflows/                             # auto-discovered (default location)
│   ├── build-task-explore.workflow.js     # design pipeline 1/3
│   ├── build-task-design.workflow.js      # design pipeline 2/3
│   ├── build-task-spec.workflow.js        # design pipeline 3/3
│   ├── build-task-plan.workflow.js        # delivery pipeline: plan
│   ├── build-task-implement.workflow.js   # delivery pipeline: implement
│   └── build-task-ship.workflow.js        # delivery pipeline: ship
├── agents/                                # auto-discovered (default location), 11 agents
│   ├── designer.md         ├── design-reviewer.md  ├── planner.md
│   ├── spec-writer.md      ├── explore-scribe.md   ├── worktree-merger.md
│   ├── pr-author.md        ├── shipper.md          ├── ci-monitor.md
│   ├── ci-fixer.md         └── decider.md
├── bin/                                   # on PATH when the plugin is enabled
│   └── ship-ensure-mergeable.mjs           # Ship-phase PR/MR merge-state remediation
└── skills/
    ├── build-task/
    │   ├── SKILL.md                       # orchestrator
    │   └── workflows/                     # one <name>.md usage reference per script
    │       └── explore.md  design.md  spec.md  plan.md  implement.md  ship.md
    ├── decide/
    │   └── SKILL.md                       # decision step: AskUserQuestion, or --headless: advisor / decider
    ├── dispatch-task/
    │   └── SKILL.md                       # background-session dispatch
    └── review-task/
        └── SKILL.md                       # commit + /simplify + /code-review --fix
```

## Usage

```text
/taskflow:build-task Add IrDA transport support to the kiosk app
```

The skill creates a `feature/<slug>` worktree and switches into it if needed (not with `--skip-branch-check`), runs the design pipeline (explore once, size the task, then design — looping through `decide` question rounds while it exits `user_input_required` — then spec), presents the spec's key points for approval, then runs the delivery steps (plan, implement, review, ship) and reports waves, review commits and the PR/MR. All intermediate files live in a `build-task/` subfolder of the session temp directory and are never committed.

```text
/taskflow:build-task --headless Add IrDA transport support to the kiosk app
```

Runs unattended: every decision goes to the advisor tool, or to the `decider` agent when the advisor is absent, and the report lists each `Decided ...` line. A design that needs more than 3 resumes, or an intent check rejected without corrections, stops the run with the draft path.

```text
/taskflow:review-task --size=M
```

Commits pending changes on the current branch, runs `/simplify` and `/code-review high --fix` against the default base branch and reports the size, the review level and the commits it made. Without `--size` it sizes the branch first; add a base ref (`/taskflow:review-task develop`) to review against another branch.
