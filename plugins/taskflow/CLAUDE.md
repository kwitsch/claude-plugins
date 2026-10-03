# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — inline orchestrator skill. Owns branch handling and `AskUserQuestion` checkpoints, invokes the design and delivery workflows by name, applies escalated review fixes.
- `skills/dispatch-task/` — one-step skill that dispatches `build-task` into a worktree-isolated background session. Self-contained by requirement: no reference to any other plugin, its own copy of the `claude --worktree … --bg` mechanics. Design notes: `skills/dispatch-task/CLAUDE.md`.
- `skills/changes-audit/` — standalone audit skill. Runs the `changes-review` workflow over the branch diff, then owns apply: `--fix` auto-applies every finding, otherwise an `AskUserQuestion` multi-select applies the picks — both by re-dispatching `fix-applier` (findings carry no patch text). Model-invocable, runs inline (depth 0). No PR/merge step.
- `workflows/design-to-spec.workflow.js` + `workflows/spec-driven-delivery.workflow.js` + `workflows/changes-review.workflow.js` — the Workflow-tool scripts that do the heavy lifting; run namespaced as `/taskflow:<name>`.
  - The `AGENTS` map (namespace = plugin name) lives in each script; `changes-review` carries only the finder/verifier subset (it never dispatches `fix-applier`).
  - Renaming the plugin requires updating the `AGENTS` namespace prefix in each script.
- `agents/*.md` — 11 static role prompts dispatched by the workflows via `agentType: 'taskflow:<name>'`. INTERNAL: each agent's description says not to delegate to it directly. `review-finder`, `review-verifier` and `fix-applier` have two entry points (`spec-driven-delivery` and `changes-review`/`changes-audit`); their frontmatter descriptions say so.
- `bin/ship-ensure-mergeable.sh` — Ship merge-state remediation: `shipper` runs it before the ci-monitor loop to auto-update a `behind` branch or auto-resolve `-X ours`-clean conflicts so CI actually starts. Zero-dep bash, `chmod +x`.

## Agent files and no-narration

- Every `agents/*.md` starts, right after frontmatter, with the identical verbatim "No narrative text between tool calls" paragraph. Copy it from an existing agent into any new one.
- Why: agents run headless inside a Workflow, so prose between tool calls is wasted tokens; only the final message (report or schema-forced output) is consumed.
- Inline workflow prompts carry the same rule as a `NO_NARRATION` prefix — see `workflows/CLAUDE.md`.

## userConfig

No `userConfig` in `plugin.json` — deliberate; see the `taskflow` entry in `.claude/rules/plugin-userconfig.md`'s no-toggle exceptions.

- `build-task` runs only on invocation (user, or the model choosing it); `dispatch-task` is `disable-model-invocation: true`, so only an explicit user invocation starts it.
- Neither skill ever runs from a hook or other unattended trigger, so there is no automatic behavior for a toggle to suppress. `dispatch-task` launches an unattended session once invoked, but the invocation itself is never automatic.

## Generated pipeline artifacts are always English

- The draft/spec/plan files the designer, spec writer and planner write (`draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md`) are always English, regardless of `$task_description`'s language.
- Enforced by an explicit instruction in `agents/designer.md`, `agents/planner.md` and the inline spec-writer prompt in `workflows/design-to-spec.workflow.js` (the spec writer has no agent file).
- Why: only other pipeline agents read these files, so a consistent working language beats mirroring the request.
- Does not extend to the final human-facing report (`SKILL.md` step 5) or to reviewer finding text.

## Resuming inside an existing worktree/PR

- `build-task` step 1 cuts a new `feature/<slug>` only when the current branch IS the base branch; otherwise it stays on the current branch, including an already-checked-out worktree with an open PR/MR.
- Ship's create-or-update (`shipper.md`, via `gh pr view <branch>`) then updates that PR/MR instead of opening a new one.
- `fix-applier.md` and `worktree-merger.md` check "is the named work/merge-target branch checked out here" (`git branch --show-current`), never "is this the primary repo root, not a worktree" — the latter would wrongly abort (fix-applier) or silently merge into the wrong branch (worktree-merger) in this case.
- A non-isolated `agent()`/Agent-tool dispatch from a worktree-isolated session resolves `pwd` and `git rev-parse --show-toplevel` to that worktree, so no checkout-path threading is needed. The bridge/remote-control cwd-defaults-to-primary-root behavior is a different path; do not conflate the two.

## Scoped notes elsewhere

- Model assignment, `NO_NARRATION` on inline prompts, the designer's `keypoints`/`openQuestions` separation, the `workflows/*.workflow.js` eslint exclusion: `workflows/CLAUDE.md`.
- `dispatch-task` design decisions, `worktree.baseRef`, why the payload passes `--skip-branch-check`: `skills/dispatch-task/CLAUDE.md`.
- SKILL.md plugin-root capture and `!`-injection rules: `.claude/rules/taskflow-skill-plugin-root-and-injection.md`.

## Tests

- Suite: `test/taskflow/` (structural). It pins literal strings of these CLAUDE.md files — grep `test/taskflow/` before renaming or moving a section.
