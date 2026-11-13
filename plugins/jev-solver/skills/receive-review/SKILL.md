---
name: receive-review
description: Handles review feedback (from jev-solver:request-review, the user or a PR) by verifying each point before changing code. Use whenever feedback arrives, especially when a point is unclear or doubtful.
---

# receive-review

Feedback is a claim to check, not an order.

1. **Read all of it** before acting. If any point is unclear, ask through `AskUserQuestion` before implementing any of them: points can depend on each other.
2. **Verify each point against the code.** Is it true? Does the suggested change break something, drop a behaviour or conflict with an earlier decision? In a graphmind project check callers with `/gm-fn` or `/gm-impact`.
3. **Decide per point:**
   - correct: fix it;
   - wrong or already handled: say so with the evidence (file and line, test output), do not implement it;
   - a matter of taste with defined options: `jev-solver:decide`, unless the reviewer is the user, whose call it is.
4. **Order of fixing:** blocking first, then simple ones, then larger ones. One change at a time, run the tests after each (`jev-solver:verify`).
5. **Reply plainly:** "fixed: what changed" or "not changed: why". No thanks, no apologies, no agreement before verification.
6. A fix that matches a missing convention or a recurring mistake: save it with `graphmind memory add --type convention` when graphmind is available.
