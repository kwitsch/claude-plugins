---
name: cc-memory
description: Audit and improve a project's memory files (every CLAUDE.md and .claude/rules/*.md) against the curated cc-reference memory rules — discover every CLAUDE.md and .claude/rules file, grade each, report quality, then interactively apply the improvements you select. Use when the user asks to check, audit, improve, grade, or maintain CLAUDE.md / .claude/rules / project-memory files.
argument-hint: [optional repo path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, Workflow, ToolSearch
# review-skip(F1): unscoped Bash/Edit/Write is required — discovery runs against an arbitrary repo path and fixes Edit/Write arbitrary CLAUDE.md files; allowed-tools only pre-approves, never restricts.
---

# cc-memory — audit & improve CLAUDE.md memory grounded in cc-reference

Audit every CLAUDE.md and `.claude/rules/*.md` file in `$ARGUMENTS` (default: the
whole current project) against the curated `cc-reference` memory rules by dispatching
the read-only `cc-reviewer` agent per file, grade each file, then gate every change
behind an interactive
selection. **This skill runs inline (depth 0)** — it dispatches agents and writes
files; never run it as `context: fork`.

The dispatched `cc-reviewer` agents are read-only. **This skill is the only
writer.**

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## 1. Resolve the scope

The scope is `$ARGUMENTS` when given, otherwise the **whole current project**
(repository root). Either way the audited set is the project's full memory surface
under that scope: every `**/CLAUDE.md` **and** every `.claude/rules/*.md` rule file
(see §2). Only include `~/.claude/CLAUDE.md` (the user-global memory) when the user
explicitly asks for it.

## 2. Discover memory files (CLAUDE.md + .claude/rules)

Run this with the Bash tool, passing the resolved scope as the argument. (Runs at
runtime, not as a load-time dynamic-context injection, because the scope may be
supplied interactively.)

```bash
ROOT="${1:-.}"
find "$ROOT" -type f \( -name CLAUDE.md -o -path '*/.claude/rules/*.md' \) \
  -not -path '*/.git/*' 2>/dev/null | sort
```

Each output line is a memory file — a `CLAUDE.md` or a `.claude/rules/*.md` rule
file (path-scoped rules, possibly with a `paths:` frontmatter glob). When the user
explicitly asked for the user-global memory (step 1), append `~/.claude/CLAUDE.md`
to this discovered set — the `find` is rooted at the scope and cannot reach a path
outside it, so the explicit request must be honored here. If the resulting set is
empty, tell the user and stop.

## 3. Analyze files (Workflow)

Read `${CLAUDE_SKILL_DIR}/analysis-workflow.md`, then run its Workflow
script (or its Agent-tool fallback) to analyze every discovered path from
§2. Inline the discovered file list and the scope note (from §1) as JS
string/array literals directly in the script text — never via the
Workflow tool's `args` parameter.

This dispatches `cc-reviewer` (Agent tool via `agentType`,
`component_type: memory`, one per discovered file, in parallel — the
`Analyze` phase) then a single aggregation agent (the `Aggregate` phase)
that computes each file's grade and the report text. Both phases run on
`model: 'sonnet'` per this repo's standing Workflow-tool directive — a
deliberate cost choice, not `cc-reviewer`'s own haiku pin (that pin is for
its direct dispatch by `cc-review`, a different skill).

The script returns `{ perFile, aggregate: { summary, perFile } }`:
`perFile` is the raw per-path findings (used by §5's gate below);
`aggregate` is the graded, report-ready structure (used by §4 below). No
file is silently dropped — the script backfills any path the aggregation
agent's output omitted.

## 4. Grade and report

Render the workflow's returned `aggregate` — do not re-derive grades or
re-parse findings; both are already computed.

Emit a report **before making any change**, in claude-md-improver's shape:

### Summary

- Files found: `aggregate.summary.filesFound`
- Files failed to analyze: `aggregate.summary.filesFailed`
- Grade distribution: `aggregate.summary.gradeDistribution` (graded files only)
- Files needing update: `aggregate.summary.filesNeedingUpdate` (graded files only)

### Per-file assessment

For each entry in `aggregate.perFile`, a block with:

- **Path** and **Grade** (with `coveredCounts` by severity and
  `uncoveredCount`, or "failed to analyze" when `failed: true`).
- **Issues** — the `issues` array, one line each.
- **Recommended actions** — the `recommendedActions` array (fixable
  `suggested_fix` items, plus manual to-dos like leanness/split
  recommendations with their candidate target).

Any file with `failed: true` is noted as failed instead of graded.

## 5. Gate via AskUserQuestion

Present each file's **selectable actions** — its fixable findings (`uncovered: false`
with a non-null `suggested_fix`) — for selection via `AskUserQuestion`, the same way
`cc-review` does. `AskUserQuestion` hard caps: at most **4 tabs** per call, each tab
**2–4 options**.

Chunking is **tab-driven** (a tab maps to one file, so a file never splits across
tabs ambiguously):

- For each file, split its severity-sorted **selectable actions** into groups of
  ≤4. Each group becomes one **tab** (≤4 options), `multiSelect: true`. A file
  with more than 4 selectable actions therefore contributes several tabs.
- Pack up to **4 tabs per `AskUserQuestion` call**. When there are more than 4
  tabs total (more than 4 files, or files that exceed 4 actions), issue successive
  calls of ≤4 tabs each until every file's every selectable action has been shown.
  Order the tabs high→med→low by their group's top severity.
- Each option label must begin with the finding `id` so a selection maps back to
  its finding record.
- If a tab would have only one action (a single finding), add an explicit
  `"Skip this group"` option so the tab has ≥2 options.

Findings with `uncovered: true` are shown as informational notes (never selectable
for auto-apply — they require manual judgment because cc-reference does not cover
them).

Each `AskUserQuestion` option applies a `suggested_fix` — an `uncovered: false`
finding with a non-null `suggested_fix`.

Leanness/split to-dos are **report-only** and never selectable here — not because
they are uncovered (they are `uncovered: false` and count toward the grade) but
because their `suggested_fix` is `null` (the same gating rule that excludes any
manual-to-do finding). `uncovered: true` findings remain informational notes.

## 6. Apply selected actions

For each selected finding (all `uncovered: false` with a non-null
`suggested_fix`), apply its `suggested_fix`: `{ "old_string", "new_string" }` →
an `Edit` call; `{ "full_content" }` → a `Write` call. Apply nothing the user did
not select. cc-memory does **not** auto-commit.

## 7. Report

Summarize per file: grade, which findings were applied, which were skipped, which
are manual to-dos (`suggested_fix: null` — including leanness/scope-split
recommendations with their candidate target), which findings are uncovered, and
any file whose reviewer failed.
