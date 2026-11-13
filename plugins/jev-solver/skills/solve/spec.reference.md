# spec

Size XL of the feature track, after the approved `design.md` ([design](design.reference.md)). Output: `spec.md` next to it (`jev-solver/<task-slug>/spec.md`, never in the repo).

1. **Write `spec.md`** from the design, precisely enough to plan from: requirements (numbered, each testable), interfaces and data shapes, error handling, affected files, migration or compatibility, how each requirement is tested. Keep the design's decisions; a changed decision goes back to the design and its confirmation.
2. **Check.** No placeholders (TODO, TBD), no contradictions with the design, nothing the task does not need, every requirement unambiguous.
3. **Review.** [request-review](request-review.reference.md) on the spec; handle findings with [receive-review](receive-review.reference.md).
4. **Confirmation** as `solve` describes (summary: requirements, interfaces, error handling, tests). Then continue with [plan](plan.reference.md).
