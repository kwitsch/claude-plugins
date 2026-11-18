# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — inline orchestrator skill. Creates a `feature/<slug>` worktree and calls `EnterWorktree`, and owns `AskUserQuestion` checkpoints, owns the whole pipeline (design and delivery), sizes the task, applies escalated review fixes.
  - Seven scripts in `workflows/`, run via `Workflow({scriptPath, args})` (not auto-discovered, no `/taskflow:` command): the design pipeline `explore.workflow.js`, `design.workflow.js`, `spec.workflow.js` and the delivery pipeline `plan.workflow.js`, `implement.workflow.js`, `review.workflow.js`, `ship.workflow.js`. Each leaves one session-temp file (`explore-<slug>.md`, `draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md`, `implement-<slug>.json`, `review-<slug>.json`, `pr-body-<slug>.md`) and returns only its path plus the small fields the skill's checkpoints and final report need. The skill never reads those files: it threads their absolute paths into the later scripts, whose agents read them.
  - Eight role files in `roles/` — `designer.md`, `design-reviewer.md`, `planner.md`, `worktree-merger.md`, `pr-author.md`, `shipper.md`, `ci-monitor.md`, `ci-fixer.md` — read by the scripts' inline agents from the absolute `SKILL_DIR` arg. No frontmatter; not plugin agents.
  - Tool hints: the skill probes graphmind (step 2.1) and jev-api (step 2.3) once and passes `GRAPHMIND_AVAILABLE`/`REPO_PATH`/`JEV_AVAILABLE` to the scripts, which append a hint to the prompts of agents that benefit — graphmind: designer, design-reviewer, implementer/reviewer/fixer, fix-applier, ci-fixer (plus explorers and planner, which already had it); jev-api: planner (task complexity via `score`), ci-monitor and ci-fixer (failure classification via `choice`). `review-finder`/`review-verifier` carry a `tools` allowlist without MCP tools, so they get no hint. Absent tool ⇒ no hint, prompt unchanged.
  - Size (`S`/`M`/`L`/`XL`, after Explore, once per invocation): jev-api's `score` tool when it loads and answers with `confidence >= 0.6`, otherwise the skill's own reasoning. Every size-driven choice comes from it: the designer model and the planner model (resolved in-script from the `SIZE` arg) and the review level (`S`/`M` → `high`, `L`/`XL` → `max`, derived by the skill and passed as `LEVEL`; no script derives it).
  - `review.workflow.js` is the one build-task script that dispatches plugin agents: its `AGENTS` map (namespace = plugin name) holds `review-finder`, `review-verifier` and `fix-applier`. Every other build-task prompt is inline.
- `skills/dispatch-task/` — one-step skill that dispatches `build-task` into a worktree-isolated background session. Self-contained by requirement: no reference to any other plugin, its own copy of the `claude --worktree … --bg` mechanics. Design notes: `skills/dispatch-task/CLAUDE.md`.
- `skills/changes-audit/` — standalone audit skill. Runs the `changes-review` workflow over the branch diff, then owns apply: `--fix` auto-applies every finding, otherwise an `AskUserQuestion` multi-select applies the picks — both by re-dispatching `fix-applier` (findings carry no patch text). Model-invocable, runs inline (depth 0). No PR/merge step.
- `workflows/changes-review.workflow.js` — the only plugin Workflow-tool script (standalone review); runs namespaced as `/taskflow:changes-review`.
  - Its `AGENTS` map carries only the finder/verifier subset (it never dispatches `fix-applier`).
  - Its review engine is a deliberate copy of `skills/build-task/workflows/review.workflow.js` (Workflow scripts cannot import each other); keep the two in step.
  - Renaming the plugin requires updating the `AGENTS` namespace prefix in both scripts.
- `agents/*.md` — 3 static role prompts dispatched via `agentType: 'taskflow:<name>'`. INTERNAL: each agent's frontmatter `description` is exactly `INTERNAL ONLY` so the model never selects one by description; callers always name them explicitly via `agentType`. `review-finder`, `review-verifier` and `fix-applier` have two callers (build-task's review script and `changes-review`/`changes-audit`).
- `bin/ship-ensure-mergeable.sh` — Ship merge-state remediation: `shipper` runs it before the ci-monitor loop to auto-update a `behind` branch or auto-resolve `-X ours`-clean conflicts so CI actually starts. Zero-dep bash, `chmod +x`.

## Agent files and no-narration

- Every `agents/*.md` starts, right after frontmatter, with the identical verbatim "No narrative text between tool calls" paragraph. Copy it from an existing agent into any new one.
- Why: agents run headless inside a Workflow, so prose between tool calls is wasted tokens; only the final message (report or schema-forced output) is consumed.
- Inline workflow prompts carry the same rule as a `NO_NARRATION` prefix — see `workflows/CLAUDE.md`.
- The eight build-task role files (`skills/build-task/roles/*.md`) have no frontmatter and no such paragraph: the inline prompts that point at them already start with `NO_NARRATION`. The design reviewer's read-only guarantee and ci-monitor's Bash-only guarantee are prompt + role-file instructions, not tool allowlists.

## userConfig

No `userConfig` in `plugin.json` — deliberate; see the `taskflow` entry in `.claude/rules/plugin-userconfig.md`'s no-toggle exceptions.

- `build-task` runs only on invocation (user, or the model choosing it); `dispatch-task` is `disable-model-invocation: true`, so only an explicit user invocation starts it.
- Neither skill ever runs from a hook or other unattended trigger, so there is no automatic behavior for a toggle to suppress. `dispatch-task` launches an unattended session once invoked, but the invocation itself is never automatic.

## Generated pipeline artifacts are always English

- The pipeline files (`explore-<slug>.md`, `draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md`) written by the explore scribe, designer, spec writer and planner are always English, regardless of `$task_description`'s language.
- Enforced by an explicit instruction in `skills/build-task/roles/designer.md`, `skills/build-task/roles/planner.md` and the inline spec-writer prompt in `skills/build-task/workflows/spec.workflow.js` (the spec writer has no role file). The explore scribe (`skills/build-task/workflows/explore.workflow.js`) adds no prose of its own: it writes the explorer reports verbatim.
- Why: only other pipeline agents read these files, so a consistent working language beats mirroring the request.
- Does not extend to the final human-facing report (`SKILL.md` step 5) or to reviewer finding text.

## Resuming inside an existing worktree/PR

- `build-task` step 1 (without `--skip-branch-check`) creates a `feature/<slug>` worktree under `.claude/worktrees/<slug>` via `EnterWorktree` `name` plus `git branch -m` (never `git worktree add` + `path`: `ExitWorktree` cannot remove such a worktree) only when the current branch IS the base branch; otherwise it stays on the current branch, including an already-checked-out worktree with an open PR/MR.
- Ship's create-or-update (`skills/build-task/roles/shipper.md`, via `gh pr view <branch>`) then updates that PR/MR instead of opening a new one.
- `agents/fix-applier.md` and `skills/build-task/roles/worktree-merger.md` check "is the named work/merge-target branch checked out here" (`git branch --show-current`), never "is this the primary repo root, not a worktree" — the latter would wrongly abort (fix-applier) or silently merge into the wrong branch (worktree-merger) in this case.
- A non-isolated `agent()`/Agent-tool dispatch from a worktree-isolated session resolves `pwd` and `git rev-parse --show-toplevel` to that worktree, so no checkout-path threading is needed. The bridge/remote-control cwd-defaults-to-primary-root behavior is a different path; do not conflate the two.

## Scoped notes elsewhere

- Model assignment (incl. the size-driven designer and planner models), `NO_NARRATION` on inline prompts, the designer's `keypoints`/`openQuestions` separation, the `*.workflow.js` eslint exclusion (also covers `skills/build-task/workflows/*.workflow.js`): `workflows/CLAUDE.md`.
- Script contracts, one per build-task script, in `skills/build-task/workflows/`: `explore.md`, `design.md`, `spec.md`, `plan.md`, `implement.md`, `review.md`, `ship.md`.
- `dispatch-task` design decisions, `worktree.baseRef`, why the payload passes `--skip-branch-check`: `skills/dispatch-task/CLAUDE.md`.
- SKILL.md plugin-root capture and `!`-injection rules: `.claude/rules/taskflow-skill-plugin-root-and-injection.md`.

## Tests

- Suite: `test/taskflow/` (structural). It pins literal strings of these CLAUDE.md files — grep `test/taskflow/` before renaming or moving a section.
