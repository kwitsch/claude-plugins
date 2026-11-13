---
name: verify
description: Runs the checks and reads their output before any claim that work is done, fixed or passing. Use before saying a task is complete, before committing and before opening a PR.
---

# verify

Evidence before claims.

1. **Name the claim** ("tests pass", "bug fixed", "builds") and the command that proves it: the project's own test, lint, type-check and build commands (see the repo's CLAUDE.md or package scripts).
2. **Run it fresh**, completely, in this turn. An earlier run, a partial run or a remembered result does not count.
3. **Read the whole output:** exit code, failure count, warnings. A bug fix is verified by the reproducing test failing before and passing after, not by the suite alone.
4. **Check against the requirement,** not just the tests: go through the spec or task line by line and confirm each item is met.
5. **Report the result as it is:** if something fails, say so with the output and fix it; if a check was skipped, say that. Only when the evidence shows success, state it plainly without hedging ("should work", "probably" are not allowed).
