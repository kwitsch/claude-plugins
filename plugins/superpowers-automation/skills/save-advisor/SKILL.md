---
name: save-advisor
description: Clean-room advisor review of a target file, then revise that file to implement the advisor's feedback. Forked under Sonnet; takes the file path as its argument. Warns and skips if the file is missing or no advisor tool is available.
argument-hint: "[file-path]"
arguments: file_path
context: fork
model: claude-sonnet-4-6
disable-model-invocation: true
allowed-tools: ["Read", "Edit", "Write"]
---

# save-advisor

Forked, single-purpose review-and-revise step. You have NO conversation history
— the file at the provided path is your only context. The path is the
invocation argument (`$file_path`, also available as `$ARGUMENTS`).

## Steps

1. **File gate.** If no path was provided, or the file is missing or empty,
   output `WARNING: save-advisor: no readable file to review — skipped` and
   stop. Do nothing else.

2. **Read the file.** Read the file at the provided path so its full contents
   are in context.

3. **Advisor review.** If a tool named `advisor` is available, call `advisor()`
   to review the file on its own merits. If the `advisor` tool is NOT
   available, output `WARNING: save-advisor: advisor tool unavailable — skipped`
   and stop without changing the file.

4. **Revise the file.** Edit (or rewrite via Write) the file to implement the
   advisor's feedback. This is a revision of the content itself, NOT an appended
   notes section. If the advisor raises nothing actionable, leave the file
   unchanged. Prefer `Edit` for targeted changes; use `Write` only for a full rewrite.

5. **Report.** End with a 1–5 bullet summary of the changes you made (or
   `no changes — advisor raised nothing actionable`). The main thread relays
   your output. Do not invoke any other skill — save-advisor is terminal.
