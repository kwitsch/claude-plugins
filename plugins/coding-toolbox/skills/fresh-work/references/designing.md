# Designing (fresh-work phase)

Produce the design doc for the described work and save it to the **spec temp path**
(SKILL.md "Session temp docs"). This phase writes nothing into the repository.

This doc is Claude's own working memory for the plan and implementation phases,
not prose written for a human to review line by line — write it dense and
structured. The pipeline's human checkpoint is SKILL.md step 5 (Intent
confirmation); self-review (below) always validates this doc — the advisor,
when this phase judges it warranted, is an additional layer on top.

## Scale to the task (your call, not a fixed step)

Judge complexity against SKILL.md's complexity heuristic, from
`$work_description` and what step 1's exploration turns up — re-judge after
exploring, not just from the one-line description; a task that reads simple
can turn out complex once the code is in front of you:

- **Simple** (the default) → do every step below yourself, inline, no
  subagents.
- **Complex** → use the Workflow tool where it earns its cost: parallel
  readers across the touched subsystems for step 1 (the tool's `Understand`
  pattern), or a judge panel of independently fleshed-out approaches for
  step 4 (the tool's `Design` pattern).

**Advisor consultation is your call too** (SKILL.md "Inline advisor
protocol") — call it when you hit a genuine uncertainty you can't resolve
from code/context, or the task turns out more complex than
`$work_description` suggested.

## Process

1. **Explore context first.** Relevant files, docs, recent commits, existing
   patterns. Understand the real flow end to end before designing.
2. **Scope check.** If the request spans multiple independent subsystems, decompose:
   name the pieces, their relations, the build order — then design only the first
   piece. One design doc = one implementable unit.
3. **Resolve open points.** Prefer resolving from code and context. Ask the user via
   `AskUserQuestion` ONLY when the answer genuinely changes the design — one question
   per message, multiple-choice options preferred (free text arrives via "Other").
   Everything else: decide, and record the assumption in the doc's Decisions section.
4. **Approaches.** Work out 2–3 approaches with trade-offs. Pick one; record why the
   others lost.
5. **Write the doc**, sections scaled to their complexity:
   - **Keypoints** (3–6 bullets, one line each): the gist a reader needs before
     anything else. SKILL.md step 5 presents this section verbatim for intent
     confirmation — it must stand alone without requiring the rest of the doc.
   - Goal (one paragraph) and Non-goals
   - Approach chosen + alternatives rejected (with reasons)
   - Detailed design: architecture, components, data flow, interfaces
   - Error handling
   - Testing strategy
   - Acceptance criteria (checkable, exact commands where possible)
   - Risks / trade-offs
   - Decisions & assumptions (everything resolved autonomously in step 3)
6. **Design for isolation.** Each unit: one clear purpose, well-defined interface,
   understandable without reading its internals. If changing internals would break
   consumers, rework the boundary.
7. **Existing codebases.** Follow established patterns. Targeted improvements only
   where the work touches broken structure; no unrelated refactoring.
8. **YAGNI ruthlessly.** Strike everything speculative.

## Self-review (always, immediately after writing)

- Placeholder scan: no TBD/TODO/vague requirements.
- Internal consistency: no section contradicts another.
- Scope: still one implementable unit.
- Ambiguity: every requirement has exactly one reading — if not, pick one and write
  it down.

Fix findings inline, then return to the orchestrator (SKILL.md step 5, Intent
confirmation). Do not start planning or implementation from here.
