# design

Size L and XL of the feature track. No spec, plan or code before the design is approved. Output: `design.md` in the scratchpad (`jev-solver/<task-slug>/design.md`, never in the repo).

1. **Explore.** Read what the task touches (see Code exploration in `solve`). Check recent commits and project conventions.
2. **Clarify.** Collect all candidate questions first and put them in one jev-api `batch` call (`noul` each: do the code and defaults already answer it?; [decide](decide.reference.md)), then ask the user only those with a confident no, one at a time through `AskUserQuestion`; only what the code and sensible defaults cannot answer. Prefer options over free text.
3. **Approaches.** For a real fork, name two or three approaches with trade-offs and pick one with a recommendation. Where the options are defined, use [decide](decide.reference.md) (`choice`) for the direction; difficulty or risk of an option goes through `score`. Keep the user's explicit choices.
4. **Write `design.md`:** goal, scope and non-goals, the approaches with the decision and why, affected components, risks. A page or two for L; the details (interfaces, error handling, tests) wait for the spec on XL and go into the plan on L.
5. **Check.** Re-read it once: no placeholders (TODO, TBD), no contradictions, nothing the task does not need, no ambiguity.
6. **Confirmation** as `solve` describes (summary: goal, scope, approach, affected components, risks). Then continue with [spec](spec.reference.md) on XL, with [plan](plan.reference.md) on L.

Size XL: also ask [request-review](request-review.reference.md) to review the design before the spec.
