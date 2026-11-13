---
name: design
description: Turns a feature or refactor task into an approved spec before any code is written. Use when jev-solver:solve routes a task to the feature track, or when the user wants a design first.
---

# design

No code and no plan before the spec is approved.

1. **Explore.** Read what the task touches: in a graphmind project start with `/gm` (`/gm-fn`, `/gm-deps`, `/gm-impact`), otherwise normal tools. Check recent commits and project conventions.
2. **Clarify.** One question at a time through `AskUserQuestion`, only what the code and sensible defaults cannot answer. Prefer options over free text.
3. **Approaches.** For a real fork, name two or three approaches with trade-offs and pick one with a recommendation. Where the options are defined, use `jev-solver:decide` (`choice`) for the direction; difficulty or risk of an option goes through `score`. Keep the user's explicit choices.
4. **Spec.** Write `spec.md` to the session scratchpad (`jev-solver/<task-slug>/spec.md`, never in the repo), sized to the task: goal, scope and non-goals, approach with the decision and why, affected files, interfaces, error handling, how it is tested. A few lines for an S task, a page or two for L.
5. **Check.** Re-read the spec once: no placeholders (TODO, TBD), no contradictions, nothing the task does not need, no ambiguity in a requirement.
6. **Approval.** Give the user the spec's full absolute path and a short summary, and ask for approval through `AskUserQuestion` (approve, change, abort). Fix and re-ask until approved. Then continue with `jev-solver:plan`.

Size XL: also ask `jev-solver:request-review` to review the spec before the plan.
