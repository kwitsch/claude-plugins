---
name: plan
description: Turns an approved spec into a step-by-step implementation plan. Use after jev-solver:design, before touching code on a multi-step task.
---

# plan

Input: the approved `spec.md` from the scratchpad. Output: `plan.md` next to it (`jev-solver/<task-slug>/plan.md`, never in the repo).

1. **Map files.** List every file to create or change, and what else the change must reach: callers, tests, fixtures, config, exports. In a graphmind project use `/gm-impact` and `/gm-deps` for this.
2. **Split into steps.** Each step is small (minutes, not hours), has an exact file list, and ends in a check you can run (a test, a build, a command with its expected result). Tests come before the code they cover (`jev-solver:tdd`).
3. **Group into phases** for size L and above, each ending in a state that builds and passes. Phase boundaries are where reviews happen (see `jev-solver:solve`).
4. **Write concrete steps.** Real paths, real commands, the code for non-obvious parts. No "add error handling", no "similar to step 3", no TODO.
5. **Self-check.** Every spec requirement maps to a step; names and signatures agree between steps; nothing in the plan is outside the spec.
6. **Hand over.** Tell the user the plan's full absolute path, then continue with `jev-solver:execute` unless the user wants to read it first. A choice between orderings or strategies with defined options goes through `jev-solver:decide`.
