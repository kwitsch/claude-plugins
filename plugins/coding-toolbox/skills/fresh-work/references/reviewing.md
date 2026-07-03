# Reviewing (fresh-work phase)

Run the branch's whole-diff quality/correctness pass after Implement, before PR.
Nothing here consumes step 7's minor-findings list — carry it forward unchanged
to the PR step (SKILL.md).

## Process

1. **Judge complexity** against SKILL.md's complexity heuristic — re-read the
   accumulated diff itself, not just the plan's own complexity guess; a plan
   that looked Simple can still produce a Complex diff once every task is in.
2. **Simplify.** Invoke `simplify` (Skill tool) over the diff to apply
   reuse/simplification/efficiency/altitude cleanups directly. Only if it
   changed anything (`git status --porcelain` non-empty) — commit those fixes
   as one commit (repo conventions). Nothing to commit if the diff was already
   clean; never force an empty commit.
3. **Code-review.** Invoke `code-review` (Skill tool, args `<effort> --fix` —
   **`high`** for a Simple diff, **`max`** for Complex, per step 1's judgment)
   over the resulting diff to find and apply correctness-bug and
   reuse/simplification/efficiency fixes. Same commit guard as step 2 — only
   commit if it changed anything, as its own separate commit. `code-review`'s
   `high`/`max` tiers trade confidence for coverage, not diff size, and `--fix`
   applies findings unconditionally except for the escalation in step 4 —
   accepted here because the pipeline's downstream CI and PR review are the
   backstop for an over-eager fix, not a call this phase should make instead.
4. **Escalate, don't silently apply, decision-reversing findings.** A finding
   that would reverse a design/plan decision (not a quality nit) → stop and
   surface it via `AskUserQuestion` instead of letting the fix apply silently.

Each sub-pass that produces changes gets its own commit (repo convention: one
fix per commit, never bundled) so the two categories of change stay
distinguishable in history, and so `code-review`'s own diff gathering sees
`simplify`'s fixes as committed history rather than stray working-tree state.
Both act on the full accumulated diff from Implement, not a single task's
commit.

## Exit

Return to the orchestrator's PR step, carrying step 7's minor-findings list
forward unchanged — this phase does not consume it; it runs its own
independent scan and has no input mechanism for that plan-specific ledger
content.
