---
name: spec-advisor-review
description: Clean-room advisor review of a freshly written superpowers spec file, then hand off to writing-plans. Invoked by the superpowers-automation specs hook (or manually) with the spec file path as its argument.
argument-hint: "<spec-file-path>"
arguments: file_path
context: fork
model: claude-haiku-4-5-20251001
allowed-tools: ["Read"]
---

# Spec advisor-review

Forked, single-purpose review step. You have NO conversation history — the spec
file is your only context. The file path is the invocation argument (`$file_path`,
also available as `$ARGUMENTS`).

## Steps

1. **Read the spec.** Read the file at the provided path. If missing or empty,
   output `WARNING: spec file <path> unreadable — review skipped` and go to step 4.

2. **Advisor review.** If a tool named `advisor` is available, call `advisor()`
   to review the spec on its own merits (complete? internally consistent?
   unambiguous? scoped to one implementation plan?). If the `advisor` tool is
   NOT available, output `WARNING: advisor tool unavailable — spec review skipped`
   and continue.

3. **Report findings** in 1–5 concise bullets (the main thread relays them).

4. **Hand off.** End your output with exactly this line so the main thread
   continues the workflow (replace `<path>` with the spec file path):
   `Spec advisor-review complete. Next: invoke the superpowers:writing-plans skill on <path> to produce the implementation plan.`

Do not invoke any other skill yourself — only the main thread continues the chain.
