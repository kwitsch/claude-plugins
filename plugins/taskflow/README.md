# taskflow

Spec-driven design & delivery pipeline for Claude Code, packaged as a plugin. `/taskflow:build-task` owns the whole pipeline: five single-phase Workflow scripts run the design pipeline (design: explore, size and draft in one script; spec) and the delivery pipeline (plan, wave-parallel implement (isolated worktrees + per-wave merge for multi-task waves), ship), and the `review-task` skill does the review between implement and ship. The design, spec and plan scripts run through the internal `design-task`, `spec-task` and `plan-task` skills, which build-task calls. `/taskflow:review-task` (`skills/review-task/`) reviews and fixes the current branch on its own: it commits pending changes, then runs its stage workflow over the branch diff against its base: Claude Code's bundled `/simplify`, read-only review jobs (the bundled `/code-review <level>`, plus ponytail-review and the CodeRabbit CLI when available), organize and fix with rereview. With `--spec=<path>`, fixes that would contradict the spec are decided through `decide`.

## Install

```text
/plugin install taskflow@kwitsch-plugins
```

Requires Claude Code v2.1.154+ (dynamic workflows). On Pro plans, enable Dynamic workflows in `/config`.

## Skills

| Skill           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-task`    | Orchestrator: creates and enters a `feature/<slug>` worktree, runs the design pipeline (`design-task`: explore → size → design → intent acceptance; then spec) and the delivery pipeline (plan → implement → review → ship). Decision checkpoints through `decide` (the design ones inside `design-task`, spec conflicts of review fixes inside `review-task`, which build-task passes its spec); `--headless` lets the advisor or the `decider` agent answer them and passes the flag to `design-task`, `spec-task`, `plan-task` and `review-task`. Final report. The size from `design-task` (the plugin's `size-task` tool: jev-api's calibrated `choice` question, else a plain Opus call, else own reasoning) picks the designer model, the planner model and the review level; the review step runs `review-task` with that size. Usage references for the implement and ship scripts live in `skills/build-task/workflows/`. |
| `decide`        | Internal decision step of `build-task`, `design-task`, `review-task`, `spec-task` and `plan-task`: shows the context as bullets and asks via `AskUserQuestion`; with `--headless` the advisor tool decides, or the `decider` agent when the advisor is absent. Ends with a `DECISIONS:` line. Not for direct use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `design-task`   | Internal step of `build-task` (step 2): explores the repository, sizes the task with the `size-task` tool and writes a reviewed design draft with the `build-task-design` script, routes every block through `decide` (a re-explore runs the script again; any other answer starts only the `designer` agent), asks for the intent acceptance, and ends with a `RESULT:` line holding the explore path, the size and the design path. Not for direct use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dispatch-task` | Hands the described task to a new worktree-isolated background session (`claude --worktree … --bg`, `sonnet`/`xhigh` by default, `--model=`/`--effort=` overridable) that runs `build-task` unattended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `plan-task`     | Internal step of `build-task` (step 4.1): turns an approved spec into a checked implementation plan with the `build-task-plan` script, routes conflicts and blocking findings left after the correction round through `decide`, asks for acceptance at size `L`/`XL`, and ends with a `RESULT:` line holding the plan path. Not for direct use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `review-task`   | Commits pending changes, then runs the `review-task-stages` workflow over the current branch's diff against its base (default: `origin/HEAD`, else `main`): `/simplify` (one commit), read-only review jobs in parallel (`/code-review <level>` always; ponytail-review and the CodeRabbit CLI when the `get-environment` tool reports them), organize (dedupe, severity) and fix with rereview (at most 2 rounds). `--spec=<path>` checks every fix against a spec and asks through `decide` before one would contradict it. `--size=S`, `M`, `L` or `XL` sets the level: `S` → `medium`, `M` → `high`, `L` → `xhigh`, `XL` → `max`; without it the branch is sized with the `size-task` tool. Refuses a detached HEAD and the base branch; never pushes. `--headless` routes any decision through `decide` without the user.                                                                                                      |
| `spec-task`     | Internal step of `build-task` (step 3): turns an approved design draft into a reviewed spec with the `build-task-spec` script; same decision, acceptance and `RESULT:` handling as `plan-task`. Not for direct use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Workflows

build-task's five scripts and review-task's `review-task-stages` are plugin workflows in `workflows/` and run by name (`taskflow:build-task-<name>`, `taskflow:review-task-stages`), never by `scriptPath` (the Workflow tool rejects a `scriptPath` outside the session's readable directories, such as the plugin cache). Each leaves session-temp files and returns only their paths plus small status fields; the skills pass those absolute paths on to the later scripts, whose agents read them. Every script reads its inputs from the `args` global (structured object); a `decodeArgs` guard fails fast with `stage: 'args'` if a run is launched without input. Per-script usage references (parameters, exit contract, behavior) live beside the skills that run them. When the graphmind MCP server is connected and the checkout is registered (`graphmind which`), the design explorers and the planner use graphmind's code graph and project memory; otherwise they fall back to the built-in Explore agent / file search.

| Script                             | Purpose                                                                                                                                                                                                                            | Output file                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `build-task-design.workflow.js`    | Scout → read-only explorers → exploration reports → size → draft design → design review → one revision round; exits complete or blocked with decide-ready questions. Run by `design-task`.                                         | `explore-<slug>.md`, `draft-<slug>.md` |
| `build-task-spec.workflow.js`      | Write spec → spec review → one fix round; pauses on a conflict or remaining blocking findings (resumable). Run by `spec-task`.                                                                                                     | `spec-<slug>.md`                       |
| `build-task-plan.workflow.js`      | Approved spec → implementation plan with machine-readable tasks → plan check → one revision round; pauses on a conflict or remaining blocking findings (resumable). Run by `plan-task`.                                            | `plan-<slug>.md`                       |
| `build-task-implement.workflow.js` | Wave-parallel implement (worktree + per-wave merge for multi-task waves; single-task waves commit directly), per-task review and fix.                                                                                              | `implement-<slug>.json`                |
| `build-task-ship.workflow.js`      | Push, PR/MR create-or-update, merge-state remediation, CI watch + bounded fix rounds. Not run when the user asked for no PR/MR.                                                                                                    | `pr-body-<slug>.md`                    |
| `review-task-stages.workflow.js`   | review-task's branch review: simplify → read-only review jobs in parallel → organize (dedupe, severity, spec check) → fix with rereview. Writes no files; run by `review-task`, usage in `skills/review-task/workflows/review.md`. | none                                   |

The review step between implement and ship is the `review-task` skill, called with build-task's spec; build-task writes its result to `review-<slug>.json` for the PR/MR body.

## Tools

`mcp__taskflow__size-task` (deferred, registered by the plugin's hooks module) sizes a task as `S`, `M`, `L` or `XL` for `design-task` (inside its workflow), `spec-task`, `plan-task` and `review-task`: the task text and subsystem lines go to jev-api's `request` tool when it is installed and, when that is unsure or missing, to a plain model call. Like every tool a plugin registers itself, it answers before Claude Code's permission check: there is no permission prompt and `ask` rules do not apply. A `permissions.deny` rule for `mcp__taskflow__size-task` removes it; the callers then size by their own reasoning.

`mcp__taskflow__get-environment` (deferred, no input, registered by the same hooks module) tells `review-task` which optional helpers the session can use, as one JSON object of five booleans: `jevApi` (jev-api's `request` tool is listed), `advisor`, `graphmind` (graphmind's `gm_search` is listed), `ponytail` (the ponytail plugin is enabled in the local, project or user settings) and `coderabbit` (the CodeRabbit CLI is on `PATH` or in `~/.local/bin`, `coderabbit auth status --agent` reports it authenticated, and its review allowance is not reported as used up). Each check takes at most 4 seconds and counts as `false` when it fails. Like `size-task`, it answers before Claude Code's permission check: there is no permission prompt and `ask` rules do not apply. A `permissions.deny` rule for `mcp__taskflow__get-environment` removes it; review-task then runs only the code-review job.

## Agents

The plugin ships 12 agents: 10 build-task roles, dispatched via `agentType` by build-task's scripts (the designer, spec writer and planner model and effort come from the task size, the rest from the script; the frontmatter `model` is only a default; `design-task` also starts the `designer` directly), `decider`, started by the `decide` skill in headless mode, and `branch-reviewer`, review-task's read-only review, organize, spec-check and rereview job. Besides the roles below, `spec-writer` writes the spec and `explore-scribe` writes the exploration file.

| Agent             | Model   | Role                                                                                                                                                  |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designer`        | by size | Writes the design draft. `S` → sonnet/medium, `M` → sonnet/high, `L` → opus/medium, `XL` → opus/high.                                                 |
| `design-reviewer` | by size | Read-only design review and open-question validation, on the designer's model at effort `medium`.                                                     |
| `planner`         | by size | Turns an approved spec into a dense, machine-executable implementation plan. Same size table as the designer.                                         |
| `worktree-merger` | haiku   | Merges approved task branches into the work branch in order, worktree cleanup (multi-task waves only).                                                |
| `pr-author`       | haiku   | Writes the PR/MR title and body from the implement and review result files and the repo template.                                                     |
| `shipper`         | haiku   | Pushes, creates-or-updates the PR/MR, then auto-updates/auto-resolves its merge-state before CI monitoring. Never force-pushes or merges the PR.      |
| `ci-monitor`      | haiku   | Read-only bounded CI poll and classification (`passed`/`failed`/`running`/`none`).                                                                    |
| `decider`         | opus    | Read-only headless decision maker for `decide` when the advisor tool is absent or unclear (`effort: high`).                                           |
| `ci-fixer`        | sonnet  | Classifies flaky/infra vs. code-caused vs. base-broken CI failures and fixes in scope.                                                                |
| `branch-reviewer` | opus    | Read-only job of review-task's stage workflow: a review skill or the CodeRabbit CLI, organize, spec check or rereview. Reports findings, never fixes. |

## Layout

```text
taskflow/
├── .claude-plugin/
│   └── plugin.json                        # name, version, metadata
├── workflows/                             # auto-discovered (default location)
│   ├── build-task-design.workflow.js      # design pipeline 1/2: explore, size, design
│   ├── build-task-spec.workflow.js        # design pipeline 2/2
│   ├── build-task-plan.workflow.js        # delivery pipeline: plan
│   ├── build-task-implement.workflow.js   # delivery pipeline: implement
│   ├── build-task-ship.workflow.js        # delivery pipeline: ship
│   └── review-task-stages.workflow.js     # review-task: simplify, review, organize, fix
├── agents/                                # auto-discovered (default location), 12 agents
│   ├── designer.md         ├── design-reviewer.md  ├── planner.md
│   ├── spec-writer.md      ├── explore-scribe.md   ├── worktree-merger.md
│   ├── pr-author.md        ├── shipper.md          ├── ci-monitor.md
│   ├── ci-fixer.md         ├── decider.md          └── branch-reviewer.md
├── bin/                                   # on PATH when the plugin is enabled
│   └── ship-ensure-mergeable.mjs           # Ship-phase PR/MR merge-state remediation
└── skills/
    ├── build-task/
    │   ├── SKILL.md                       # orchestrator
    │   └── workflows/                     # one <name>.md usage reference per script it runs directly
    │       └── implement.md  ship.md
    ├── decide/
    │   └── SKILL.md                       # decision step: AskUserQuestion, or --headless: advisor / decider
    ├── design-task/
    │   ├── SKILL.md                       # build-task step 2: prompt → explore, size, approved design
    │   └── workflows/design.md            # design script usage reference
    ├── dispatch-task/
    │   └── SKILL.md                       # background-session dispatch
    ├── plan-task/
    │   ├── SKILL.md                       # build-task step 4.1: spec → checked plan
    │   └── workflows/plan.md              # plan script usage reference
    ├── review-task/
    │   ├── SKILL.md                       # commit + stage workflow + spec decisions
    │   └── workflows/review.md            # stage script usage reference
    └── spec-task/
        ├── SKILL.md                       # build-task step 3: draft → reviewed spec
        └── workflows/spec.md              # spec script usage reference
```

## Usage

```text
/taskflow:build-task Add IrDA transport support to the kiosk app
```

The skill creates a `feature/<slug>` worktree and switches into it if needed (not with `--skip-branch-check`), runs the design pipeline (`design-task`: explore, size and design, every block answered through `decide`, then the intent acceptance of the design's key points; then spec), then runs the delivery steps (plan, implement, review, ship) and reports waves, review commits and the PR/MR. All intermediate files live in a `build-task/` subfolder of the session temp directory and are never committed.

```text
/taskflow:build-task --headless Add IrDA transport support to the kiosk app
```

Runs unattended: every decision goes to the advisor tool, or to the `decider` agent when the advisor is absent, and the report lists each `Decided ...` line. A design that needs more than 3 re-runs, or an intent check rejected without corrections, stops the run with the draft path.

```text
/taskflow:review-task --size=M --spec=docs/spec.md
```

Commits pending changes on the current branch, runs the stage workflow against the default base branch (simplify, the code-review job at level `high` plus the optional ponytail and CodeRabbit jobs, organize, fix with rereview) and reports the size, the review level, the environment, the commits it made and the unresolved findings. With `--spec`, each fix that would contradict the spec is put to you first. Without `--size` it sizes the branch first; add a base ref (`/taskflow:review-task develop`) to review against another branch.
