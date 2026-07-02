# Designing (fresh-work phase)

Produce the design doc for the described work and save it to the **spec temp path**
(SKILL.md "Session temp docs"). This phase writes nothing into the repository.

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

Fix findings inline, then return to the orchestrator (SKILL.md step 5, advisor
pass). Do not start planning or implementation from here.
