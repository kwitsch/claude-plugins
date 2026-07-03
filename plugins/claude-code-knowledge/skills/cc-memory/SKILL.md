---
name: cc-memory
description: Audit and improve a project's memory files (every CLAUDE.md and .claude/rules/*.md) against the curated cc-reference memory rules — discover every CLAUDE.md and .claude/rules file, grade each, report quality, then interactively apply the improvements you select. Use when the user asks to check, audit, improve, grade, or maintain CLAUDE.md / .claude/rules / project-memory files.
argument-hint: [optional repo path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, mcp__plugin_context-mode_context-mode__*, ToolSearch
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

## context-mode routing (optional acceleration)

If the context-mode MCP tools are available, route heavy work through them so large
output stays out of context — leaner, faster turns. Fall back to native tools when
absent; never block on context-mode.

- **Read-only / output-heavy shell** (no filesystem or git writes) → run via
  `ctx_execute` (one command) or `ctx_batch_execute` (several), printing only the
  answer. Load the tools once with
  `ToolSearch(query: "select:mcp__plugin_context-mode_context-mode__ctx_execute,mcp__plugin_context-mode_context-mode__ctx_batch_execute")`
  (retry the bare names `select:ctx_execute,ctx_batch_execute`); if neither
  resolves, run the command via Bash.
- **State-mutating shell** (writes files, `git` commits/pushes, edits settings) →
  always native Bash; the ctx sandbox discards filesystem and git writes.

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

## 3. Dispatch reviewers (parallel)

For each discovered path (both `CLAUDE.md` and `.claude/rules/*.md` files), dispatch
the `cc-reviewer` agent (Agent tool, `subagent_type: claude-code-knowledge:cc-reviewer`)
in a single message so they run concurrently. Both kinds are audited as
`component_type: memory` — the cc-reference memory section covers CLAUDE.md *and*
path-scoped `.claude/rules/` files. Each dispatch prompt must state:

```text
component_type: memory
target_paths: <path to one memory file — a CLAUDE.md or a .claude/rules/*.md file>

In addition to the usual memory rule-compliance findings, also surface — against
the cc-reference memory rules you already apply — these leanness/splittability
findings:
- LENGTH/LEANNESS: if the file exceeds the cc-reference ~200-line target, emit a
  finding noting the length and that it should be trimmed.
- SPLITTABILITY: if a section's content is scoped to ONE subdirectory, recommend
  moving it to that subdirectory's CLAUDE.md (grounded in the cc-reference
  locations table — subdir files load on-demand). If a section's content applies
  to a FILE TYPE / EXTENSION across the tree, recommend moving it to
  .claude/rules/ with a `paths:` glob, e.g. `paths: ["**/*.kt"]` (grounded in the
  cc-reference "What belongs" table). Both targets are co-equal; choose by scope.
  When the target IS itself a `.claude/rules/*.md` file, the move-into-`.claude/rules/`
  branch does not apply (it is already a rule file) and the ~200-line LENGTH target is
  advisory there rather than a cited rule — for a rule file, audit what genuinely fits
  it (e.g. a well-formed `paths:` frontmatter glob, terseness) and skip the rest.

For every leanness/splittability finding: set `uncovered: false` (cc-reference
covers both the 200-line target and the .claude/rules/+paths: route),
`suggested_fix: null` (new-file/multi-file coordination — recommend-only), and
severity `low` (or at most `med` for an egregiously long file) — NEVER `high`.
Include the candidate target path / `paths:` glob in the `recommendation` text.

Return ONLY the JSON findings array per your output contract.
```

## 4. Grade and report

Parse each agent's JSON findings array. For each file derive a quality grade from
the **covered** findings only (those with `uncovered: false`). `uncovered: true`
findings are gaps in cc-reference coverage — do not count them toward the grade
(a presentation aid over the findings, NOT a second rule source):

| Covered findings | Grade |
|---|---|
| none | A |
| only `low` | B |
| any `med`, no `high` | C |
| one `high` | D |
| multiple `high` | F |

Leanness/splittability findings (§3) are `uncovered: false` and therefore **count
toward this table** — capped at `med`, they can lower a grade to C but never to
D/F on their own (faithful to claude-md-improver's Conciseness criterion).

Emit a report **before making any change**, in claude-md-improver's shape:

### Summary
- Files found: N
- Grade distribution (or average): …
- Files needing update: N (grade < A, or any fixable finding / actionable task)

### Per-file assessment
For each file, a block with:
- **Path** and **Grade** (with covered finding counts by severity, uncovered count).
- **Issues** — the findings (one line each: severity · rule · issue).
- **Recommended actions** — fixable `suggested_fix` items, plus manual to-dos
  (leanness/split recommendations with their candidate target path / `paths:`
  glob).

If an agent returns non-JSON or errors, note that file as failed and continue
with the others.

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
