# taskflow

Spec-driven design & delivery pipeline for Claude Code, packaged as a plugin. `/taskflow:build-task` runs the design pipeline — three single-phase Workflow scripts shipped inside the skill (explore, design, spec: explore, draft, review, spec) — and the `spec-driven-delivery` workflow (plan, wave-parallel implement (isolated worktrees + per-wave merge for multi-task waves), combined review, fix application). `/taskflow:changes-audit` (`skills/changes-audit/`) runs the same combined review standalone over a branch diff — no plan/spec/ship — then optionally applies the findings (`--fix` auto-applies all, otherwise an `AskUserQuestion` multi-select applies your picks).

## Install

```text
/plugin install taskflow@kwitsch-plugins
```

Requires Claude Code v2.1.154+ (dynamic workflows). On Pro plans, enable Dynamic workflows in `/config`.

## Skills

| Skill           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-task`    | Orchestrator: creates and enters a `feature/<slug>` worktree, runs the design pipeline (explore → size → design → spec; scripts and the designer/design-reviewer role files live in `skills/build-task/workflows/` and `roles/`), `AskUserQuestion` checkpoints (open design questions, spec approval, escalated review fixes), final report. Sizes the task with jev-api's `score` tool when available, otherwise by its own reasoning. Invokes the `spec-driven-delivery` workflow below. |
| `dispatch-task` | Hands the described task to a new worktree-isolated background session (`claude --worktree … --bg`, `sonnet`/`xhigh` by default, `--model=`/`--effort=` overridable) that runs `build-task` unattended.                                                                                                                                                                                                                                                                                     |
| `changes-audit` | Runs the `changes-review` workflow over the current branch's committed diff, then applies findings by re-dispatching `fix-applier`: `--fix` auto-applies every finding, otherwise an `AskUserQuestion` multi-select applies only your picks. Report-only lean (over-engineering) findings are never applied.                                                                                                                                                                                |

## Workflows

The plugin-root `workflows/` directory holds the two workflows below. They are auto-discovered — no manifest field needed — so skills invoke them by name, namespaced as `/taskflow:<name>`. build-task's design pipeline is not a plugin workflow: its three scripts (`explore.workflow.js`, `design.workflow.js`, `spec.workflow.js`) live in `skills/build-task/workflows/` and run by `scriptPath`; each writes one session-temp file (`explore-<slug>.md`, `draft-<slug>.md`, `spec-<slug>.md`) and returns only its path plus small status fields. Every script reads its inputs from the `args` global (structured object); a `decodeArgs` guard fails fast with `stage: 'args'` if a run is launched without input. Per-script usage references (parameters, exit contract, behavior) live in `skills/build-task/workflows/`. When the graphmind MCP server is connected and the checkout is registered (`graphmind which`), the design explorers and the planner use graphmind's code graph and project memory; otherwise they fall back to the built-in Explore agent / file search.

| Workflow               | Purpose                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec-driven-delivery` | Plan → wave-parallel Implement (worktree + per-wave merge for multi-task waves; single-task waves commit directly) → combined Review → fix application → Ship (push, PR/MR, CI watch + bounded fix rounds).                                                                  |
| `changes-review`       | Standalone combined Review over a branch diff — correctness angles + cleanup lenses, independently verified, plus a report-only lean pass. No plan/spec/apply/ship. Invoked by the `changes-audit` skill (not `build-task`); returns verified `findings` + `ponytailReview`. |

## Agents

Static role prompts (rules, lens catalog, verdict ladder, git procedures), dispatched by the workflows via `agentType`; models set in frontmatter.

| Agent             | Model  | Role                                                                                                                                                          |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planner`         | opus   | Turns an approved spec into a dense, machine-executable implementation plan. Workflow dispatch picks sonnet/opus/fable per run by difficulty — see CLAUDE.md. |
| `review-finder`   | sonnet | Reviews one assigned lens (5 correctness angles + 5 cleanup lenses) over a diff.                                                                              |
| `review-verifier` | sonnet | Independently verifies review candidates — CONFIRMED / PLAUSIBLE / REFUTED.                                                                                   |
| `worktree-merger` | haiku  | Merges approved task branches into the work branch in order, worktree cleanup (multi-task waves only).                                                        |
| `fix-applier`     | sonnet | Applies pre-verified review fixes by category, with a test-run safety gate.                                                                                   |
| `pr-author`       | haiku  | Writes the PR/MR title and body from the pipeline summary and repo template.                                                                                  |
| `shipper`         | haiku  | Pushes, creates-or-updates the PR/MR, then auto-updates/auto-resolves its merge-state before CI monitoring. Never force-pushes or merges the PR.              |
| `ci-monitor`      | haiku  | Read-only bounded CI poll and classification (`passed`/`failed`/`running`/`none`).                                                                            |
| `ci-fixer`        | sonnet | Classifies flaky/infra vs. code-caused vs. base-broken CI failures and fixes in scope.                                                                        |

The designer and the design reviewer are not plugin agents: they are role files in `skills/build-task/roles/` read by the design script's inline agents. Designer model from the task size (`S` → sonnet, `M`/`L` → opus, `XL` → fable); design reviewer on sonnet.

## Layout

```text
taskflow/
├── .claude-plugin/
│   └── plugin.json                        # name, version, metadata
├── workflows/                             # auto-discovered (default location)
│   ├── spec-driven-delivery.workflow.js
│   └── changes-review.workflow.js
├── agents/                                # auto-discovered (default location)
│   ├── planner.md          ├── review-finder.md    ├── review-verifier.md
│   ├── worktree-merger.md  ├── fix-applier.md      ├── pr-author.md
│   ├── shipper.md          ├── ci-monitor.md       └── ci-fixer.md
├── bin/                                   # on PATH when the plugin is enabled
│   └── ship-ensure-mergeable.sh           # Ship-phase PR/MR merge-state remediation
└── skills/
    ├── build-task/
    │   ├── SKILL.md                       # orchestrator
    │   ├── workflows/
    │   │   ├── explore.workflow.js        # design pipeline 1/3 (run by scriptPath)
    │   │   ├── design.workflow.js         # design pipeline 2/3
    │   │   ├── spec.workflow.js           # design pipeline 3/3
    │   │   ├── explore.md                 # parameters + exit contract
    │   │   ├── design.md                  # parameters + exit contract
    │   │   └── spec.md                    # parameters + exit contract
    │   ├── roles/
    │   │   ├── designer.md                # role file (design script)
    │   │   └── design-reviewer.md         # role file (design script)
    │   └── references/
    │       └── spec-driven-delivery.md    # parameters + exit contract
    ├── dispatch-task/
    │   └── SKILL.md                       # background-session dispatch
    └── changes-audit/
        └── SKILL.md                       # standalone review + optional apply
```

## Usage

```text
/taskflow:build-task Add IrDA transport support to the kiosk app
```

The skill creates a `feature/<slug>` worktree and switches into it if needed (not with `--skip-branch-check`), runs the design pipeline (explore once, size the task, then design — looping through `AskUserQuestion` rounds while it exits `user_input_required` — then spec), presents the spec's key points for approval, then runs the delivery workflow and reports waves, findings, and commits. All intermediate files live in a `build-task/` subfolder of the session temp directory and are never committed.
