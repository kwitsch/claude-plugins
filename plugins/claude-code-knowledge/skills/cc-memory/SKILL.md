---
name: cc-memory
description: Audit and improve the CLAUDE.md memory files across a repository against the curated cc-reference memory rules — discover every CLAUDE.md, grade each, report quality, then interactively apply the improvements you select. Use when the user asks to check, audit, improve, grade, or maintain CLAUDE.md / project-memory files.
argument-hint: [optional repo path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, Skill
# review-skip(F1): unscoped Bash/Edit/Write is required — discovery runs against an arbitrary repo path and fixes Edit/Write arbitrary CLAUDE.md files; Skill is required to invoke cave-context:cave-compress on a selected CLAUDE.md; allowed-tools only pre-approves, never restricts.
---

# cc-memory — audit & improve CLAUDE.md memory grounded in cc-reference

Audit every CLAUDE.md in `$ARGUMENTS` (default: the current repo) against the
curated `cc-reference` memory rules by dispatching the read-only `cc-reviewer`
agent per file, grade each file, then gate every change behind an interactive
selection. **This skill runs inline (depth 0)** — it dispatches agents and writes
files; never run it as `context: fork`.

The dispatched `cc-reviewer` agents are read-only. **This skill is the only
writer.**

## 0. Preconditions — detect cave-compress (depth 0, model-side)

Before anything else, decide whether the compression behavior is active. **If
`cave-context:cave-compress` appears in your available skills, set
`COMPRESS_AVAILABLE = true`; otherwise `COMPRESS_AVAILABLE = false`.** This is a
model-side check against your available-skills listing (the same way other
orchestrators check for an optional sibling skill) — deliberately NOT a
load-time dynamic-context block, because this skill's discovery must stay runtime
Bash and a skill cannot reliably enumerate available skills from a shell. The
cave-compress skill is only visible here at depth 0, never inside the read-only
`cc-reviewer` subagent.

When `COMPRESS_AVAILABLE` is false, skip every compression substep below (no
heuristic in §4b, no compression option in §5, no `cave-compress` call in §6) —
silently, with no mention to the user.

## 1. Resolve the scope

The scope is `$ARGUMENTS` when given, otherwise the current repository root. Only
include `~/.claude/CLAUDE.md` (the user-global memory) when the user explicitly
asks for it.

## 2. Discover CLAUDE.md files

Run this with the Bash tool, passing the resolved scope as the argument. (Runs at
runtime, not as a load-time dynamic-context injection, because the scope may be
supplied interactively.)

```bash
ROOT="${1:-.}"
find "$ROOT" -type f -name CLAUDE.md -not -path '*/.git/*' 2>/dev/null | sort
```

Each output line is a CLAUDE.md path. When the user explicitly asked for the
user-global memory (step 1), append `~/.claude/CLAUDE.md` to this discovered set —
the `find` is rooted at the scope and cannot reach a path outside it, so the
explicit request must be honored here. If the resulting set is empty, tell the user
and stop.

## 3. Dispatch reviewers (parallel)

For each discovered path, dispatch the `cc-reviewer` agent (Agent tool,
`subagent_type: claude-code-knowledge:cc-reviewer`) in a single message so they run
concurrently. Each dispatch prompt must state:

```
component_type: memory
target_paths: <path to one CLAUDE.md>

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

Report a per-file summary (path, grade, covered finding count by severity, uncovered
finding count) BEFORE making any change. If an agent returns non-JSON or errors, note
that file as failed and continue with the others.

## 5. Gate via AskUserQuestion

Present the fixable findings (those with `uncovered: false` and a non-null
`suggested_fix`) for selection via `AskUserQuestion`, the same way `cc-review`
does. `AskUserQuestion` hard caps: at most **4 tabs** per call, each tab **2–4
options**.

Chunking is **tab-driven** (a tab maps to one file, so a file never splits across
tabs ambiguously):

- For each file, split its severity-sorted fixable findings into groups of ≤4.
  Each group becomes one **tab** (≤4 options), `multiSelect: true`. A file with
  more than 4 fixable findings therefore contributes several tabs.
- Pack up to **4 tabs per `AskUserQuestion` call**. When there are more than 4
  tabs total (more than 4 files, or files that exceed 4 findings), issue
  successive calls of ≤4 tabs each until every file's every fixable finding has
  been shown. Order the tabs high→med→low by their group's top severity.
- Each option label must begin with the finding `id` so a selection maps back to
  its finding record.
- If a tab would have only one finding, add an explicit `"Skip this group"` option
  so the tab has ≥2 options.

Findings with `uncovered: true` are shown as informational notes (never selectable
for auto-apply — they require manual judgment because cc-reference does not cover
them).

## 6. Apply selected findings

For each selected finding (all have `uncovered: false`), apply its `suggested_fix`:
`{ "old_string", "new_string" }` → an `Edit` call; `{ "full_content" }` → a
`Write` call. Apply nothing the user did not select.

## 7. Report

Summarize per file: grade, which findings were applied, which were skipped, which
are manual to-dos (`suggested_fix: null`), which are uncovered, and any file whose
reviewer failed.
