---
name: plan-advisor-review
description: Clean-room advisor review of a freshly written superpowers plan file, then hand off to subagent-driven-development. Invoked by the superpowers-automation plans hook (or manually) with the plan file path as its argument.
argument-hint: "<plan-file-path>"
arguments: file_path
context: fork
model: claude-haiku-4-5-20251001
allowed-tools: ["Read"]
---

# Plan advisor-review

Forked, single-purpose review step. You have NO conversation history — the plan
file is your only context. The file path is the invocation argument (`$file_path`,
also available as `$ARGUMENTS`).

## Steps

1. **Read the plan.** Read the file at the provided path. If missing or empty,
   output `WARNING: plan file <path> unreadable — review skipped` and go to step 4.

2. **Advisor review.** If a tool named `advisor` is available, call `advisor()`
   to review the plan on its own merits (tasks bite-sized? exact file paths?
   complete code per step, no placeholders? types/signatures consistent across
   tasks? TDD order?). If the `advisor` tool is NOT available, output
   `WARNING: advisor tool unavailable — plan review skipped` and continue.

3. **Report findings** in 1–5 concise bullets (the main thread relays them).

4. **Hand off.** End your output with exactly this line so the main thread
   continues the workflow (replace `<path>` with the plan file path):
   `Plan advisor-review complete. Next: invoke the superpowers:subagent-driven-development skill to implement <path> task-by-task.`

Do not invoke any other skill yourself — only the main thread continues the chain.
