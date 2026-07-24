---
name: refactoring
description: >-
  Runs fresh-work's design-path pipeline for refactor-classified work by
  delegating to feature-development, which owns that pipeline (refactor and
  feature share it identically; only the branch prefix differs). Invoked by
  fresh-work after it classifies work as a refactor and cuts the branch.
argument-hint: "[work-description]"
arguments: work_description
allowed-tools: ["Skill"]
---

# refactoring

Runs fresh-work's design-path pipeline for `refactor`-classified work. The
`refactor` and `feature` classifications share an identical pipeline today
(only the branch prefix differs, decided before this skill is invoked) —
rather than duplicate ~700 lines of Design/Plan/Implement/Review logic across
two skill directories, this skill is a deliberate thin delegator, same
precedent as coding-toolbox's `setup-rules`/`refresh-tools-rule` split.
Invoked by `fresh-work` after it classifies work as `refactor` and cuts the
branch.

## Steps

1. Invoke `coding-toolbox:feature-development` (Skill tool) with
   `$work_description`, unchanged. Terminal step.
