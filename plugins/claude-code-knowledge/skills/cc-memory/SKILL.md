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
  glob), plus — when `COMPRESS_AVAILABLE` — the compression offer from §4b.

If an agent returns non-JSON or errors, note that file as failed and continue
with the others.

## 4b. Compression check (only when `COMPRESS_AVAILABLE`)

Skip this entire section when `COMPRESS_AVAILABLE` is false.

For each discovered `CLAUDE.md`, `Read` the file and apply a **lightweight
prose-density heuristic** to decide whether it is *likely not yet compressed*.
Language-neutral signals of uncompressed prose: multi-clause full sentences,
auxiliary verbs (`should`, `would`, `can be`), filler phrasing, and explanatory
paragraphs. When uncertain, **bias toward offering compression** — false
positives are cheap: `cave-compress` self-reports "already terse — no changes"
if the guess was wrong.

For each file judged likely-uncompressed, add a **"Compress with cave-compress"**
actionable task to that file's Recommended actions (§4).

**Precedence note:** if a file also has a leanness/split to-do, recommend running
compression FIRST and re-evaluating length afterward — compression may bring the
file under the 200-line target and make the split unnecessary. (This is a
*recommendation* ordering, distinct from the *execution* ordering in §6.)

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

**Two selectable action kinds.** Each `AskUserQuestion` option is either:
1. **apply a `suggested_fix`** (existing behavior — `uncovered: false` finding
   with a non-null `suggested_fix`), or
2. **compress `<file>` with cave-compress** (only when `COMPRESS_AVAILABLE`, one
   option per likely-uncompressed file from §4b).

Leanness/split to-dos are **report-only** and never selectable here — not because
they are uncovered (they are `uncovered: false` and count toward the grade) but
because their `suggested_fix` is `null` (the same gating rule that excludes any
manual-to-do finding). `uncovered: true` findings remain informational notes.

## 6. Apply selected actions

Apply in this strict order:

1. **Content fixes FIRST.** For each selected finding (all `uncovered: false`
   with a non-null `suggested_fix`), apply its `suggested_fix`:
   `{ "old_string", "new_string" }` → an `Edit` call; `{ "full_content" }` → a
   `Write` call. Apply nothing the user did not select.
2. **Compressions LAST.** For each selected "compress `<file>`" action, invoke
   the `cave-context:cave-compress` skill (Skill tool) on that file.

Ordering rationale: `cave-compress` is a **lossy in-place rewrite** that would
invalidate the `old_string` anchors of any not-yet-applied fix, so all content
fixes must land before any compression runs. `cave-compress` runs **its own**
recoverability + scope gates (a `CLAUDE.md` is auto-allowed by its `**/CLAUDE.md`
glob); cc-memory does **not** auto-commit — if the just-applied edits are
uncommitted, the user may pass cave-compress's recoverability prompt.

## 7. Report

Summarize per file: grade, which findings were applied, which were skipped, which
are manual to-dos (`suggested_fix: null` — including leanness/scope-split
recommendations with their candidate target), the compression outcome when one
was run (`compressed` / `already terse` / `skipped`), which findings are uncovered,
and any file whose reviewer failed.
