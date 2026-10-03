# CLAUDE.md — coding-toolbox skill: feature-development

`SKILL.md` and `references/*.md` are canonical for the phase mechanics; this file keeps only rationale and pitfalls.

## Skill design (`feature-development`)

### Ownership

- Owns both `feature` and `refactor` — the pipeline is identical, only the branch prefix differs and `fresh-work` decides it before invoking this skill.
- Do not re-add a `refactoring` delegator skill — it was pure indirection with no behavioral difference from a direct call.
- `fresh-work` owns classify/branch/PR; this skill runs once a branch exists and returns without opening a PR.
- This skill's Review is scoped to the design path's multi-task diffs; `debugging`'s own verify step covers a single targeted fix.
- Keep the directory self-contained (no cross-plugin references) — a bats tripwire enforces it.
- The full line-by-line human spec-review gate and execution-choice handoffs are deliberately absent; Intent confirmation is the one human checkpoint.

### Step numbering

- Nest numbering under a caller's active step (`Step 4.1`…`4.5` under `fresh-work`'s `Step 4: Dispatch`, one level deeper again for Implement's per-wave steps); fall back to independent top-level `Step 1`…`Step 5` only when invoked standalone.
  - Why: unconditional top-level numbering collided with `fresh-work`'s own step numbers.
- Never suspend or complete the caller's `Step 4` early — it stays `in_progress` for the whole nested call.
  - Why: `references/dispatch-shared.md`'s "exactly one in_progress" rule is scoped per skill's own segment of the shared ledger, not a global count.

### `AskUserQuestion` and `allowed-tools`

- Never re-add `AskUserQuestion` to this skill's `allowed-tools`.
  - Why: `allowed-tools` only pre-approves (it does not restrict, per `.claude/rules/skill-md-authoring.md`), and the remaining call sites must stay deliberate, not blanket-approved: design open-point clarification, the intent gate, Review's design-reversal escalation, the advisor protocol's decision-conflict escalation.
  - Re-check that list when adding a call site.
  - The missing-description/branch-collision asks and the 3-or-more-attempts escalation belong to `fresh-work`/`debugging`.
- Keep `Grep`/`Glob` in `allowed-tools` — Implement and Review have legitimate inline uses; only Design/Plan's own codebase-understanding step is restricted (next section).

### Intent confirmation

- Keypoints from the design doc are a mandatory numbered pre-step: read fresh from the spec temp path and emitted as their own plain-text message before the `AskUserQuestion` call.
  - Why: the generic step-start announcement does not substitute; a regression asked the question without ever showing the summary.

### Design and Plan

- Dispatch codebase exploration to the `explore` agent (Agent tool, `subagent_type: explore`), never inline Grep/Glob/Read — even in the Simple case.
  - Why: inline exploration makes this skill's own model do every raw tool call instead of a cheap search specialist.
  - Planning has no explore step of its own, but any fresh codebase fact it needs routes through the same dispatch.
- Self-review always runs; consulting the advisor is an on-demand judgment call, not a pipeline step, and there is no clean-room fork.
- Design doc and plan are session temp files (scratchpad dir, `mktemp` fallback), never committed.

### Implement

- Run waves from the dependency analysis in `references/implementing.md`; a wave of size 1 is the original sequential flow.
- Isolate each concurrent implementer in its own git worktree — disjoint files alone do not make same-tree concurrent self-commits safe (the shared git index corrupts commit boundaries).
- Merge each approved task back with `git merge --no-ff` before the next wave starts; a merge conflict is a hard stop, never auto-resolved (the wave analysis missed a real dependency).
- Inline `planPath`/`constraints`/`tasks` as JS literals in the Workflow script, never via the Workflow tool's `args`.
  - Why: `args` arrived `undefined` inside the script twice, on a fresh call and on a `resumeFromRunId` retry.
- Derive `waves` inside the script via `computeWaves(tasks)` — never hand-compute wave leveling and paste it in.
- Source `tasks` from the plan's mandatory `## Machine-readable tasks` JSON block (written by Plan in the same pass as the prose tasks), not by re-parsing plan prose.
- Do not merge Plan and Implement into one workflow — it would pin Plan to a zero-context Sonnet agent for no determinism gain, since Implement is already a Workflow.

### Review

- Run ONE combined read-only review workflow over the full branch diff after Implement (`references/reviewing.md`), replacing the former `simplify`-then-`code-review --fix` pair, whose cleanup pass ran twice, the first time unverified.
- Keep one finder per cleanup lens (not a single merged cleanup finder) and verify every candidate before applying; the synthesizer flags `reversesDecision` findings against the plan/spec.
- Pin every workflow agent to `model: 'sonnet'`.
- Escalate flagged findings via `AskUserQuestion`, apply the rest inline, and commit correctness and cleanup fixes as two separate commits — a deliberate override of "one fix per commit" at category granularity; never leave them pending for `fresh-pr`.
- Prompt texts are vendored verbatim from the built-in `/code-review` workflow and `/simplify` skill; lineage is recorded only here.
- Leave `DIFF_CMD` unprefixed — no `rtk`.
  - Why: `rtk git diff` silently truncates large hunks (it dropped 341 real added lines behind a placeholder on a real commit), the same risk that rules out rtk for a reviewer's `git show`.
  - Whether a run gets rtk compaction stays up to the operator's own environment (e.g. a personal `rtk hook claude` hook), not this plugin.
- The Agent-engine fallback batches finders, then verifiers, under the subagent-reconciliation gate (`.claude/rules/coding-toolbox-subagent-reconciliation.md`); the Workflow engine gates internally.
- Deliberately given up: a second independent cleanup pass over already-fixed code; downstream CI and PR review are the backstop for an over-eager auto-fix.
