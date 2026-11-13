# jev-solver

A collection of workflow skills modelled on the superpowers plugin, without its SessionStart steering and subagent-driven-development. Start with `/jev-solver:solve <task>`.

## Requirements

The `jev-api` plugin (declared as dependency) with `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` or `JEV_URL` set. Without it, or on any jev-api error, the skills decide with Claude's own reasoning.

## Skills

| Skill            | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| `solve`          | Entry point. Triages the task (track and size) through jev-api and routes it  |
| `decide`         | Shared rule for direction decisions through jev-api `choice`, `score`, `noul` |
| `design`         | Explores the task and writes a spec to the session scratchpad                 |
| `plan`           | Turns the spec into a step-by-step plan in the scratchpad                     |
| `execute`        | Carries out the plan inline, step by step                                     |
| `tdd`            | Test first, then code                                                         |
| `debug`          | Root cause before any fix                                                     |
| `request-review` | Reviews a change; depth depends on size                                       |
| `receive-review` | Handles review feedback with verification                                     |
| `verify`         | Evidence before any success claim                                             |
| `worktree`       | Own worktree on a `feat/` or `fix/` branch, entered by `solve` for every task |
| `finish`         | Wraps up a finished branch                                                    |

## Tracks

| Track   | Flow                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| tiny    | Implement directly, light review of the diff                                                                   |
| feature | design, plan, execute, verify, `/simplify`; review depth grows with size (M, L, XL), then `/code-review --fix` |
| bugfix  | `fix/` branch, debug, failing test, one fix, verify, review, `/code-review --fix`                              |

## Options

| Option       | Default | Meaning                                                                |
| ------------ | ------- | ---------------------------------------------------------------------- |
| `confidence` | `0.6`   | Minimum confidence of a jev-api answer that is accepted for a decision |

## Notes

- Specs and plans live in the session scratchpad, never in the repository.
- When graphmind is available (`graphmind which` succeeds), the skills explore code with `/gm` first.
