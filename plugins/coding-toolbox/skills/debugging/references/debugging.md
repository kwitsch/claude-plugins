# Debugging

Iron law: **no fixes before the root cause is understood.** Symptom patches breed
regressions; every fix flows through the four phases below, on the work branch.

## Phase 1 — Root-cause investigation

- Read error messages and stack traces completely; note line numbers, paths, codes.
- Reproduce consistently. Not reproducible → gather more data, never guess.
- Check recent changes: diff, commits, new dependencies, config, environment.
- Multi-component systems: before proposing anything, instrument each component
  boundary (log what enters, what exits, config propagation), run once, and let the
  evidence say WHERE it breaks — then investigate that component.
- Deep-stack errors: trace the bad value backward to its origin. Fix at the source,
  not where it surfaced.

## Phase 2 — Pattern analysis

Find a working example of the same pattern in the codebase; compare against the
broken path; list every difference; understand each dependency involved.

## Phase 3 — Hypothesis and testing

One hypothesis at a time: state what you believe, test it with the smallest possible
change, confirmed → Phase 4, refuted → next hypothesis with the new information.

## Phase 4 — Implementation

1. **Failing test first — mandatory.** Simplest reproduction of the bug as an
   automated test (one-off script only if no framework exists). Watch it fail for
   the expected reason.
2. Single fix at the root cause. One change at a time; no while-I'm-here
   improvements; no bundled refactoring.
3. Verify: the new test passes, the full suite stays green, the original symptom is
   gone. Grep every caller of what you changed — one guard in the shared function
   beats one guard per caller.
4. Fix didn't work: count attempts. Fewer than 3 → back to Phase 1 with the new
   information. **3 or more → stop; the architecture is in question** (each fix
   revealing new coupling elsewhere is the tell). Consult the advisor tool when one
   is available; then put the direction decision to the user via `AskUserQuestion`
   (keep patching vs. restructure) — that call is genuinely the user's.

## Exit

Fix verified (failing test green, suite green) and committed following the repo's
commit conventions → return to the caller (`fresh-work`) — do not open a PR;
that is `fresh-work`'s job, run after this skill returns. Nothing to fix after
all (not reproducible, external cause): document the evidence and report — do
not invent a change.
