# plan

Size M, L and XL of the feature track. Input: the approved `spec.md` (XL), else the approved `design.md` (L), else the task text (M). Output: `plan.md` next to them (`jev-solver/<task-slug>/plan.md`, never in the repo).

1. **Map files.** List every file to create or change, and what else the change must reach: callers, tests, fixtures, config, exports. On M, read what the task touches first and ask what the code cannot answer through `AskUserQuestion` (one jev-api `batch` of `noul` questions first, as in [design](design.reference.md)).
2. **Split into steps.** Each step is small (minutes, not hours), has an exact file list, and ends in a check you can run (a test, a build, a command with its expected result). Tests come before the code they cover ([tdd](tdd.reference.md)).
3. **Group into phases** for size L and above, each ending in a state that builds and passes. Phase boundaries are where reviews happen (see `solve`).
4. **Write concrete steps.** Real paths, real commands, the code for non-obvious parts. No "add error handling", no "similar to step 3", no TODO.
5. **Size check** (not with `--size`): rate the plan's size with `score`, in one `batch` call together with any open ordering or strategy `choice` of the plan ([decide](decide.reference.md)); if it is higher than the triage size, use the higher size for the rest of the run and say so in one line.
6. **Self-check.** Every requirement of the input maps to a step; names and signatures agree between steps; nothing in the plan is outside the input. A choice between orderings or strategies with defined options goes through [decide](decide.reference.md).
7. **Confirmation** as `solve` describes (summary: phases and steps, files, checks). Then continue with [execute](execute.reference.md).
