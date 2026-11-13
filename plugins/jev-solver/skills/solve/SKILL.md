---
name: solve
description: Single entry point for any coding task (change, feature, refactor, bug). Triages the task through the jev-api tools and routes it to the right track. Use when the user hands over a task to implement or fix.
---

# solve

Entry point. Do not start work before the triage below.

## 1. Triage

Ask jev-api once, with the user's task text as `state`:

```yaml
mcp__jev-api__batch
questions:
  - type: choice
    instructions: Which kind of task is this?
    criteria:
      tiny: a very small change (rename, typo, one-line or config tweak, one small edit)
      feature: new behaviour, a feature, a refactor or anything needing design decisions
      bugfix: something is broken, a failing test, an error, unexpected behaviour
  - type: score
    instructions: How large is the work?
    criteria: [S: a few lines in one place, M: one component, L: several components, XL: cross-cutting or architectural]
```

The score is fractional: round to the nearest level. Apply the confidence rule of `jev-solver:decide` to the track; if it is low or the call fails (any error, no configuration), triage with your own reasoning using the same criteria and say so in one line.

When the track is `feature` or `bugfix` and the task text is ambiguous, ask the user via `AskUserQuestion` first. Never ask as plain text.

## 2. Worktree and work branch

Always, for every track, right after triage and before any spec, plan, debugging or edit:

1. **Branch name.** Derive it from the task now: prefix `fix/` for the bugfix track, `feat/` for tiny and feature, then a short kebab-case slug of at most 40 characters (`fix/login-timeout`, `feat/retry-config`). Follow the repo's branch conventions if CLAUDE.md names any; the prefix stays.
2. **Enter a worktree.** Call `EnterWorktree` (load it via ToolSearch if deferred) with the slug as its name. Skip only when the session already is in a linked worktree (`jev-solver:worktree` step 1); never nest.
3. **Switch to the work branch.** In the worktree, `git switch -c <branch>` (the harness names its own branch, for example `worktree-<name>`); in an already-linked worktree whose branch has no commits of its own, do the same. A branch that already has its own commits stays.
4. Report branch and worktree path in one line, then continue. The same slug names the scratchpad directory below.

Details and baseline: `jev-solver:worktree`.

## 3. Tracks

### tiny

Implement directly. Then `jev-solver:verify` and a light review: read your own diff once (`git diff`), nothing more. No spec, no plan.

### feature

1. `jev-solver:design`: writes the spec to the scratchpad; the user approves it.
2. `jev-solver:plan`: writes the plan to the scratchpad.
3. `jev-solver:execute` (with `jev-solver:tdd` for code).
4. `jev-solver:verify`.
5. `jev-solver:request-review`, depth by size:

| Size | Review                                                          |
| ---- | --------------------------------------------------------------- |
| S    | read your own diff                                              |
| M    | one review of the final diff                                    |
| L    | a review after each plan phase, plus one of the final diff      |
| XL   | additionally a review of the spec and of the plan before coding |

Findings are handled with `jev-solver:receive-review`. Then `jev-solver:finish`.

### bugfix

On its `fix/` work branch (step 2): `jev-solver:debug` (root cause, failing test, one fix), `jev-solver:verify`, `jev-solver:request-review` (S, M: read your own diff; L and above: one review of the final diff; findings via `jev-solver:receive-review`), `jev-solver:finish`. No spec or plan, unless the root cause shows the fix is really a feature: then switch to the feature track and say so.

## Documents

Spec, plan and review notes live in the session scratchpad directory (named in the system prompt) under `jev-solver/<task-slug>/` (`spec.md`, `plan.md`, `review.md`), never in the repository. Name them with their full absolute path when you mention them to the user.

## Code exploration

In a graphmind project (`graphmind which` exits 0) start every exploration with `/gm` (`/gm-fn` for reading a symbol, `/gm-impact` for blast radius); grep only for string literals and config. Otherwise use the normal tools. Save decisions and conventions found along the way with `graphmind memory add` (project scope).
