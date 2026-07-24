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
"skip if already resolved" guard for it. Keep exactly one task `in_progress`.

**Step-start reporting.** Each time a step task moves to `in_progress`, state
one short line to the user naming it before starting its work — plain output,
never a question.
