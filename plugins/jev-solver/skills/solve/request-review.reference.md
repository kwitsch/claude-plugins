# request-review

Review the change as a reader who has not seen how it was made.

1. **Scope.** The diff to review: `git diff <base>...HEAD` (or the phase's commits).
2. **Depth by size** (from `solve`): the review table of the track in `solve`.
3. **Check, in this order:** it does what the spec or task says and nothing more; correctness and edge cases; callers, tests and fixtures the change must also touch; security and data loss; tests exist for new logic and really test it; simplicity (anything to delete or merge).
4. **Report** to `review.md` in the scratchpad for L and above (`jev-solver/<task-slug>/review.md`), in chat for smaller ones. Each finding: file and line, what is wrong, the failing scenario, severity (blocking, should fix, note). No praise filler, no style nitpicks the linter already covers.
5. **Rate every finding's severity** with [decide](decide.reference.md) (`score`: note, should fix, blocking; all findings in one `batch` call), and verify against the code before acting.
6. Hand the findings to [receive-review](receive-review.reference.md). Re-review only what the fixes changed.

The clean-context pass is `/code-review <level> --fix`, run by `solve` after this skill (level by size: S low, M medium, L high, XL xhigh); do not spawn subagents on your own for this.
