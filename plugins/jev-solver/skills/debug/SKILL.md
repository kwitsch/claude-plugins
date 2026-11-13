---
name: debug
description: Finds the root cause of a bug, failing test or unexpected behaviour before any fix. Use for every bug, test failure or error, on its own work branch.
---

# debug

No fix before the root cause is known.

0. **Own branch.** Work in a worktree on a `fix/` branch (`jev-solver:solve` sets it up, else `jev-solver:worktree`), never on `main`.
1. **Reproduce.** Get the failure reliably, with the exact error text and the smallest steps. If you cannot reproduce it, gather more data instead of guessing.
2. **Investigate.** Read the full error and stack trace. Check what changed recently (`git log`, `git diff`). Trace the bad value backwards to where it first goes wrong. In a graphmind project use `/gm-fn` (callers and callees) and `/gm-impact`; with several components, add a log or print at each boundary and find which one breaks.
3. **Compare.** Find similar working code in the project and list every difference to the failing code.
4. **Hypothesis.** State one cause ("X is wrong because Y") and test it with the smallest possible change, one variable at a time. If wrong, form a new hypothesis; do not stack fixes. With several plausible causes of defined kinds, `jev-solver:decide` can rank them, but the evidence decides.
5. **Fix.** Write a failing test that reproduces the bug first (`jev-solver:tdd`), then make one targeted change at the root cause, in the shared code, after checking all callers of what you touch. No refactoring on the side.
6. **Verify.** The new test and the whole suite pass (`jev-solver:verify`). Save the bug and its cause with `graphmind memory add --type bug` when graphmind is available.

After three failed fix attempts, stop: the assumption about the design is probably wrong. Say so to the user and ask through `AskUserQuestion` how to continue.
