---
name: request-review
description: Reviews a change before it is merged, with depth matched to its size. Use after a phase or a finished task, as set by jev-solver:solve.
---

# request-review

Review the change as a reader who has not seen how it was made.

1. **Scope.** The diff to review: `git diff <base>...HEAD` (or the phase's commits). In a graphmind project run `/gm-diff` (diff impact) and `/gm-impact` on the changed symbols to see what else the change reaches.
2. **Depth by size** (from `jev-solver:solve`): S read your own diff once; M one pass over the final diff; L per phase plus a final pass; XL also the spec and plan.
3. **Check, in this order:** it does what the spec or task says and nothing more; correctness and edge cases; callers, tests and fixtures the change must also touch; security and data loss; tests exist for new logic and really test it; simplicity (anything to delete or merge).
4. **Report** to `review.md` in the scratchpad for L and above (`jev-solver/<task-slug>/review.md`), in chat for smaller ones. Each finding: file and line, what is wrong, the failing scenario, severity (blocking, should fix, note). No praise filler, no style nitpicks the linter already covers.
5. **Rate blocking findings** when unsure with `jev-solver:decide` (`score`), but verify against the code before acting.
6. Hand the findings to `jev-solver:receive-review`. Re-review only what the fixes changed.

The clean-context pass is `/code-review <level> --fix`, run by `jev-solver:solve` after this skill (level by size: S low, M medium, L high, XL xhigh); do not spawn subagents on your own for this.
