# jev-solver

One workflow skill modelled on the superpowers plugin, without its SessionStart steering and subagent-driven-development. Start with `/jev-solver:solve <task>`.

## Requirements

The `jev-api` plugin (declared as dependency) with `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` or `JEV_URL` set. Without it, or on any jev-api error, the skill decides with Claude's own reasoning.

## Skill, references and agent

`solve` is the only skill. Its phases are reference files next to it (`skills/solve/<name>.reference.md`), loaded through the decision matrix in `solve/SKILL.md`: `decide`, `worktree`, `design`, `spec`, `plan`, `pr`, `execute`, `tdd`, `debug`, `verify`, `request-review`, `receive-review`, `finish`.

The `decider` agent answers the questions of a `--headless` run: opus with high effort for sizes S, M and L, Fable with high effort for XL.

## Arguments

| Argument               | Meaning                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `--headless`           | No `AskUserQuestion`; the `decider` agent is asked instead, with the options, task and document paths |
| `--type=<tiny\|feature\|bugfix>` | Uses that track instead of the triage choice                                                  |
| `--size=<S\|M\|L\|XL>` | Uses that size instead of the triage score                                                            |

Without `--headless`, every question goes through `AskUserQuestion`.

Every track pushes after the first commit and opens a draft PR, updates the PR description on every push, and ends with the branch pushed, up to date with its base (conflicts resolved), checks green and the PR marked ready (merge-ready).

## Tracks

| Track   | Flow                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| tiny    | Implement directly, light review of the diff                                                                                                        |
| feature | by size: S direct; M plan; L design, plan; XL design, spec, plan (each confirmed), then execute, verify, `/simplify`, reviews, `/code-review --fix` |
| bugfix  | `fix/` branch, debug, failing test, one fix, verify, review, `/code-review --fix`                                                                   |

## Options

| Option       | Default | Meaning                                                                |
| ------------ | ------- | ---------------------------------------------------------------------- |
| `confidence` | `0.6`   | Minimum confidence of a jev-api answer that is accepted for a decision |

## Notes

- Specs and plans live in the session scratchpad, never in the repository.
- When graphmind is available (`graphmind which` succeeds), the skills explore code with `/gm` first.
