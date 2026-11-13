# receive-review

Feedback is a claim to check, not an order.

1. **Read all of it** before acting. Put all points in one jev-api `batch` call (`state`: the numbered points with their code excerpts; per point a `noul` for unclear and one for correct, plus a `choice` for each matter of taste; [decide](decide.reference.md)); for the unclear answers: if any is confidently unclear, ask through `AskUserQuestion` before implementing any of them: points can depend on each other.
2. **Verify each point against the code.** The batch answer says whether it is correct; then check it yourself; the code decides when they disagree. Is it true? Does the suggested change break something, drop a behaviour or conflict with an earlier decision?
3. **Decide per point:**
   - correct: fix it;
   - wrong or already handled: say so with the evidence (file and line, test output), do not implement it;
   - a matter of taste with defined options: the `choice` of the batch ([decide](decide.reference.md)), unless the reviewer is the user, whose call it is.
4. **Order of fixing:** blocking first, then simple ones, then larger ones. One change at a time, run the tests after each ([verify](verify.reference.md)).
5. **Reply plainly:** "fixed: what changed" or "not changed: why". No thanks, no apologies, no agreement before verification.
6. A fix that matches a missing convention or a recurring mistake: save it with `graphmind memory add --type convention` when graphmind is available.
