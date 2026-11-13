---
name: execute
description: Carries out a written plan inline, step by step, with a check after each step. Use after jev-solver:plan, or for a tiny change that needs no plan.
---

# execute

Run the plan in this session, in order. No subagents.

1. **Branch.** `jev-solver:solve` already put you in a worktree on a `feat/` or `fix/` branch; confirm with `git branch --show-current`, and use `jev-solver:worktree` if you started outside solve.
2. **Read the whole plan first.** If a step is unclear or wrong, stop and ask through `AskUserQuestion` before coding around it.
3. **Per step:** mark it in progress, follow it exactly (tests first, `jev-solver:tdd`), run its check, mark it done. Commit per step or per phase, following the repo's commit conventions.
4. **Stop and ask** when a dependency is missing, a check fails repeatedly, the plan has a gap, or you do not understand an instruction. Do not guess. A failing check is a `jev-solver:debug` case, not something to patch over.
5. **Phase end** (size L and above): `jev-solver:request-review` on the phase's diff before the next phase.
6. **Done:** `jev-solver:verify`, then the final review for the size (see `jev-solver:solve`), then `jev-solver:finish`.

Do not add anything the plan does not call for; note ideas for later instead.
