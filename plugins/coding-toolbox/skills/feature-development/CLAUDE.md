# CLAUDE.md — coding-toolbox skill: feature-development

## Skill design (`feature-development`)

Split out of `fresh-work` 2026-07-24 (was its design-path pipeline, steps
4-9) alongside `debugging` (the fix path). Owns both the `feature` and
`refactor` classifications directly (the two share an identical pipeline —
only the branch prefix differs, decided by `fresh-work` before this skill is
invoked); a dedicated `refactoring` delegator skill existed briefly the same
day and was removed once Review flagged it as pure indirection with no
behavioral difference from a direct call — see `fresh-work`'s own section.
Owns the pipeline: `skills/feature-development/SKILL.md` + four phase guides
under `references/` (moved verbatim from `fresh-work`, Read only when their
phase starts) run design → **intent confirmation** → plan → implement →
**review** (combined review workflow). `fresh-work` still owns classify/branch/PR
— this skill is invoked (Skill tool) once a branch already exists, and
returns to `fresh-work` afterward without opening a PR itself; `debugging`'s
own verify step (new test passes, suite green, symptom gone) covers a single
targeted fix, where this skill's Review is scoped to the design path's
larger, multi-task diffs. **Step numbering nests under a caller's active
step** when invoked from `fresh-work` (`Step 4.1`…`Step 4.5` under
`fresh-work`'s `Step 4: Dispatch`, recursing one further level for
Implement's own per-wave `Step N.1…N.x`), falling back to independent
top-level `Step 1`…`Step 5` only when invoked standalone with no caller step
`in_progress` — fixed the same day a same-session Review pass caught the
original unconditional top-level numbering colliding with `fresh-work`'s own
step numbers. `fresh-work`'s `Step 4` task is never suspended or completed
early to make room for this — it legitimately stays `in_progress` for the
whole nested call, since `references/dispatch-shared.md`'s "exactly one
in_progress" rule is scoped to each skill's own step-list segment of the
shared ledger, not a global count across it (a CodeRabbit finding on the PR
caught that nesting the _numbering_ alone, without stating this lifecycle
explicitly, left the actual ledger-invariant question — what happens to the
caller's task while the callee runs — unanswered). Adapted
from an external multi-step methodology (brainstorming / writing-plans /
subagent-driven-development lineage — see git history for the source) — with
the full line-by-line human spec-review gate, execution-choice handoffs, and
cross-plugin references removed; self-containment of this directory is
enforced by its own bats tripwire. Two narrower
steps were reintroduced later (2026-07-03, into the original `fresh-work`),
distinct from what was removed: **Intent confirmation** (this skill's own
step 2) shows the design doc's mandatory Keypoints section and asks
`AskUserQuestion` whether to proceed — the pipeline's one deliberate
human-facing checkpoint (hardened 2026-07-07: the Keypoints output is now a
mandatory numbered pre-step — read fresh from the spec temp path, emitted as
its own plain-text message before the `AskUserQuestion` call — made
explicitly distinct from the generic Task-list step-start announcement,
after a regression where the confirmation question was asked without the
design summary ever being shown); **Review** (step 5, `references/reviewing.md`)
runs ONE combined read-only review workflow over the full branch diff after
Implement — 2026-07-11, replacing the former `simplify`-then-`code-review
--fix` built-in-skill pair after observing both live: `code-review`'s cleanup
finder carries all four `simplify` lenses verbatim, so the pair did the
cleanup work twice, the first time entirely unverified (an earlier analysis
had rejected exactly this consolidation over altitude coverage + redundancy;
the explicit user decision to merge compensates both, as noted below).
Structure: correctness angles (3 at `high` effort for a Simple diff, 5 plus a
gap-hunt sweep at `max` for Complex, per this skill's own complexity
heuristic) plus one finder PER cleanup lens
(reuse/simplification/efficiency/altitude/CLAUDE.md-conventions — per-lens
granularity deliberately kept from `simplify`, unlike the built-in's single
merged cleanup finder), every candidate location-group verified
(CONFIRMED/PLAUSIBLE/REFUTED — cleanup findings are now verified before
apply, which `simplify` never did), a synthesizer that flags
`reversesDecision` findings against the plan/spec temp docs; all workflow
agents are pinned `model: 'sonnet'`. This skill then escalates flagged
findings via `AskUserQuestion`, applies the rest inline (keeping `simplify`'s
skip rule), and commits correctness and cleanup fixes as two separate
commits — a deliberate override of the repo's usual "one fix per commit,
never bundled" convention, at category granularity, never left pending for
`fresh-pr` to pick up. Prompt texts (correctness angles A–E, cleanup lenses,
verdict ladder) are vendored verbatim from the built-in `/code-review`
workflow and `/simplify` skill — lineage recorded only here, same precedent
as the `ci-watch.sh` port; the Agent-engine fallback batches finders then
verifiers under the subagent-reconciliation gate. Reviewing's Scope-phase
`DIFF_CMD` (the exact `git diff <base>...HEAD` every finder re-runs) was
evaluated for an rtk prefix (2026-07-16) and rejected: `rtk git diff`
silently truncates large hunks past a threshold (reproduced on this repo's
own commit `cb93fbb`, dropping 341 real added lines behind a truncation
placeholder) — the same risk that already rules out rtk for a reviewer's
`git show`; `DIFF_CMD` is therefore left unprefixed, so whether a run gets
rtk-compaction stays contingent on the operator's own environment (a personal
`rtk hook claude` PreToolUse hook gives it for free on some machines, not by
design of this plugin). Deliberately given up: the second independent
cleanup pass over already-fixed code; downstream CI + PR review stay the
backstop for an over-eager auto-fix. Design doc + plan are session temp files
(scratchpad dir, `mktemp` fallback), never committed. Design and Plan
(2026-07-03) each self-review **always**; consulting the advisor is their own
on-demand judgment call (a genuine uncertainty, or the task turning out more
complex than expected) — no longer a fixed pipeline step, no clean-room fork.
`AskUserQuestion` is deliberately absent from this skill's own
`allowed-tools` (it only pre-approves; `.claude/rules/skill-md-authoring.md`
— it does NOT restrict the tool) — its remaining call sites (a design
open-point clarification, the intent gate, the Review step's design-reversal
escalation, the advisor protocol's own decision-conflict escalation whenever
Design or Plan consults it) are meant to stay deliberate, not
blanket-approved; do not "fix" this by re-adding it, and re-check this list
if a new call site is added (the missing-work-description/branch-name-collision
asks and the fix path's 3-or-more-attempts escalation now belong to
`fresh-work`/`debugging` respectively — see their own sections).
Implementation is "workflow-driven development": a deterministic per-task
implement→review→fix loop, grouped into dependency waves computed from each
task's declared `Files`/`Interfaces` (`references/implementing.md`'s
Parallelism analysis, 2026-07-05) — a wave of size 1 (the common case) is
byte-for-byte the original sequential flow; a wave with 2+ independent
tasks dispatches concurrently (Workflow-tool `parallel()`, or a batched
multi-block Agent-tool message in the fallback engine), each implementer
isolated in its own git worktree (same-tree concurrent self-commits would
silently corrupt commit boundaries through the shared git index — disjoint
files alone do not make that safe) and self-reporting its branch/worktree
path via structured output, followed by a `git merge --no-ff` merge-back of
every approved task before the next wave starts; a merge conflict is a hard
stop, never auto-resolved, since it can only mean the wave analysis missed
a real dependency. This skill's own Task-list integration section separately
requires a one-line step-start announcement before each top-level step (and
each Implement wave) begins, so a long-running pipeline is never silent.
The Workflow-engine script inlines `planPath`/`constraints`/`tasks` as JS
literals rather than passing them via the Workflow tool's `args` parameter
(`references/implementing.md`, 2026-07-03) — `args` was observed twice to
arrive `undefined` inside the script even when supplied correctly, on both a
fresh call and a `resumeFromRunId` retry. `waves` is not part of that
inlining — it's derived inside the script by a plain `computeWaves(tasks)`
function (2026-07-05 simplify pass), so the wave-leveling arithmetic is never
hand-computed by the model and pasted in as a literal. `tasks`
itself is sourced (2026-07-11) from the plan's mandatory `## Machine-readable tasks`
JSON block, authored by the Plan phase in the same pass that writes the prose tasks
(`references/planning.md`), so this skill no longer re-parses its own plan
prose into the structured task list — the one genuine robustness gain a full
Plan+Implement workflow merge was reached for, captured without merging the phases
(the merge was analysed and rejected: it would regress the highest-leverage step by
pinning Plan to a zero-context Sonnet agent for ~zero determinism gain, since
Implement is already a Workflow).

**Design and Plan dispatch codebase exploration to the `explore` agent, never
inline Grep/Glob/Read** (fixed the same day `setup-explore` was added — the
Simple-complexity default previously told both phases to explore "yourself,
inline, no subagents," which meant this skill's own model, not a cheap
haiku-pinned search specialist, did every raw Grep/Glob/Read call itself).
`references/designing.md`'s step 1 now dispatches the `explore` agent (Agent
tool, `subagent_type: explore`) even in the Simple case — only the remaining
steps (writing the doc, etc.) stay inline; Complex work dispatches several in
parallel, one per touched subsystem. `references/planning.md` has no explicit
explore step of its own (it drafts from the already-explored design doc), but
any fresh codebase fact Planning still needs — an exact signature, a file's
current contents, an existing pattern — routes through the same `explore`
dispatch under "File structure first," never a direct tool call. `Grep`/`Glob`
stay in this skill's own `allowed-tools` regardless — Implement and Review
still have legitimate inline uses for them (e.g. reviewing.md's finder-agent
prompts instruct their own dispatched subagents to Grep, a different tool
grant than this orchestrating skill's own calls) — only Design/Plan's own
codebase-understanding step is restricted.
