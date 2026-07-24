# Shared dispatch scaffolding (fresh-work / feature-development)

Read by both `fresh-work/SKILL.md` and `feature-development/SKILL.md` — kept
in one place instead of duplicated in both, since it never changes
independently per skill.

> **User decisions go through `AskUserQuestion`** — fixed-choice and open-ended
> alike; never plain prose that waits for a typed reply.

## Task-list integration (core)

Track progress with the Task tools, never TodoWrite. Load them once
(`ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`,
deferred; resolve at depth 0) — cheap and idempotent even if a caller skill
already resolved them earlier in the same inline execution; don't build a
"skip if already resolved" guard for it.

**"Exactly one in_progress" is scoped to this skill's own step list, not a
global count over the whole shared ledger.** The physical ledger is shared
across skills, but each skill's own steps are a distinct segment of it
(identified by a shared numeric prefix — see each skill's own Task-list
section for its nesting rule). When this skill dispatches synchronously to a
nested skill (e.g. `fresh-work`'s `Step 4: Dispatch` invoking
`feature-development`), the caller's own dispatch-step task **legitimately
stays `in_progress` for the entire nested call** — it represents "waiting on
the callee's step list to finish," not an idle/forgotten task — while the
callee independently keeps at most one of its OWN segment's entries
`in_progress` at a time. Never mark the caller's dispatch-step task
`completed` before the callee actually returns.

**Step-start reporting.** Each time a step task moves to `in_progress`, state
one short line to the user naming it before starting its work — plain output,
never a question.
