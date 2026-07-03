# Planning (fresh-work phase)

Turn the revised design doc into an implementation plan and save it to the **plan temp path**
(SKILL.md "Session temp docs"). Nothing is written into the repository.

Write for an implementer who is skilled but has **zero context** for this codebase
and questionable taste: exact file paths, complete code in every step, exact
commands with expected output. Each implementer sees only their own task.

## Plan header (mandatory)

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** executed task-by-task by fresh-work's workflow-driven
> implementation phase (SKILL.md step 8). Steps use checkbox (`- [ ]`) syntax.

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

Fix inline, then return to the orchestrator (SKILL.md step 7, advisor pass). Do not
pick an execution mode and do not start implementing — the engine is fixed by
`references/implementing.md`.
