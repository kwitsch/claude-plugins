# Planning (fresh-work phase)

Turn the revised design doc into an implementation plan and save it to the **plan temp path**
(SKILL.md "Session temp docs"). Nothing is written into the repository.

Like the design doc, this plan is Claude's own execution memory for the
implementer/reviewer/fixer workers, never a human — keep it dense, exact, and
complete rather than polished. The human checkpoint already happened at Intent
confirmation (SKILL.md step 5); self-review (below) always validates this file —
the advisor, when this phase judges it warranted, is an additional layer on
top — before it goes to the implementers.

Write for an implementer who is skilled but has **zero context** for this codebase
and questionable taste: exact file paths, complete code in every step, exact
commands with expected output. Each implementer sees only their own task.

## Scale to the task (your call, not a fixed step)

Judge complexity against SKILL.md's complexity heuristic — re-judge from the
revised design doc, which may show more or less complexity than the original
one-line description implied:

- **Simple** (the default) → draft the plan yourself, inline, no subagents.
- **Complex** (many independent files/subsystems) → consider the Workflow tool
  for drafting task groups in parallel (one agent per subsystem's tasks, then
  merge and re-check cross-task interfaces yourself).

**Advisor consultation is your call too** (SKILL.md "Inline advisor
protocol") — call it when you hit a genuine uncertainty, or the plan reveals
the task is more complex than the design doc assumed.

## Plan header (mandatory)

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** executed task-by-task by fresh-work's workflow-driven
> implementation phase (SKILL.md step 7). Steps use checkbox (`- [ ]`) syntax.

**Goal:** [one sentence]
**Architecture:** [2–3 sentences]
**Tech Stack:** [key technologies]
**Design doc:** [absolute spec temp path]

## Global Constraints

[Project-wide requirements verbatim from the design doc — one line each, exact
values. Every task's requirements implicitly include this section.]
```

## File structure first

Before defining tasks, map which files are created/modified and each one's single
responsibility. Split by responsibility, not technical layer; follow existing repo
patterns. This locks decomposition before task writing starts.

## Task right-sizing

A task is the smallest unit that carries its own test cycle and is worth a fresh
reviewer's gate. Fold setup/config/docs into the task whose deliverable needs them;
split only where a reviewer could reject one task while approving its neighbor.
Every task ends with an independently verifiable deliverable and its own commit.

## Task template

```markdown
### Task N: [Component]

**Files:**
- Create/Modify/Test: exact paths (with line ranges for modifications)

**Interfaces:**
- Consumes: exact names/signatures from earlier tasks
- Produces: exact names/signatures later tasks rely on

- [ ] Step 1: Write the failing test   (code block with the actual test)
- [ ] Step 2: Run it, verify it fails  (exact command + expected failure)
- [ ] Step 3: Minimal implementation   (code block with the actual code)
- [ ] Step 4: Run tests, verify pass   (exact command + expected output)
- [ ] Step 5: Commit                   (exact git commands, repo conventions)
```

## Files/Interfaces are load-bearing

`references/implementing.md`'s wave-parallel dispatch schedules tasks from each
one's `Files` and `Interfaces` — carried verbatim into the `## Machine-readable
tasks` block below, which is what implementing.md actually consumes — to decide
which tasks can safely run concurrently; they are no longer documentation-only. An
incomplete `Files` list, or a `Consumes` entry that doesn't name an exact earlier
`Produces` value, forces that task to be conservatively serialized behind everything
before it — never silently parallelized. Keep them exact — and keep the JSON block
faithful to them — for that reason, not only for reader clarity.

## Machine-readable tasks (mandatory)

End the plan with a single fenced json block under the exact heading
`## Machine-readable tasks`. It is the **single source** `references/implementing.md`
inlines as its `tasks` value — authored here, in the same pass that wrote the prose
tasks above, and **never re-parsed** from that prose by a later phase. One object per
task, in plan (dependency) order:

```json
[
  { "id": "1", "title": "Component name", "files": ["exact/path.ext"], "consumes": [], "produces": ["ExactName"] }
]
```

- `id` / `title` — the task number and heading, verbatim.
- `files` — every path from that task's `**Files:**` bullet (Create/Modify/Test all
  count), without any `(lines N-M)` annotation.
- `consumes` / `produces` — the exact names from its `**Interfaces:**` section
  (`[]` when none).

These fields drive `references/implementing.md`'s `computeWaves` scheduling directly,
so they must match the prose task sections exactly — an omission here silently
mis-levels the waves, the same failure mode the load-bearing note above describes.

## No placeholders

Plan failures — never write them: "TBD", "TODO", "implement later", "add
appropriate error handling", "write tests for the above" without the test code,
"similar to Task N" instead of repeating the content, steps that say what without
showing how, references to names defined in no task.

## Self-review (always, after writing)

1. **Coverage:** every design-doc requirement maps to a task — list gaps, add tasks.
2. **Placeholder scan:** hunt the patterns above; fix.
3. **Name/type consistency:** identifiers used in later tasks match their defining
   task exactly.
4. **Machine-readable block:** the `## Machine-readable tasks` block is present,
   valid JSON, one entry per prose task, every `id` numeric and unique, with
   `files`/`consumes`/`produces` matching each task's `**Files:**`/`**Interfaces:**`
   sections exactly.

Fix inline, then return to the orchestrator (SKILL.md step 7, Implement). Do not
pick an execution mode and do not start implementing — the engine is fixed by
`references/implementing.md`.
