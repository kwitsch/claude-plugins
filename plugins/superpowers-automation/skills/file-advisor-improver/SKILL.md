---
name: file-advisor-improver
description: Clean-room advisor review of one specific file passed by path — typically a freshly written spec or plan — then revise that file in place to implement the advisor's feedback. Forked under Sonnet. Invoke with the target file path as the argument; warns and skips if the file is missing/empty or no advisor tool is available. Not a general file editor — only for reviewing-and-revising a named file.
argument-hint: "[file-path]"
arguments: file_path
context: fork
model: claude-sonnet-4-6
allowed-tools: ["Read", "Edit", "Write"]
---

# file-advisor-improver

Forked, single-purpose review-and-revise step. You have NO conversation history
— the file at the provided path is your only context. The path is the
invocation argument (`$file_path`, also available as `$ARGUMENTS`).

## Steps

1. **File gate.** If no path was provided, or the file is missing or empty,
   output `WARNING: file-advisor-improver: no readable file to review — skipped` and
   stop. Do nothing else.

2. **Read the file.** Read the file at the provided path so its full contents
   are in context.

3. **Advisor review.** If a tool named `advisor` is available, call `advisor()`
   to review the file on its own merits. If the `advisor` tool is NOT
   available, output `WARNING: file-advisor-improver: advisor tool unavailable — skipped`
   and stop without changing the file.

4. **Revise the file.** Edit (or rewrite via Write) the file to implement the
   advisor's feedback. This is a revision of the content itself, NOT an appended
   notes section. If the advisor raises nothing actionable, leave the file
   unchanged. Prefer `Edit` for targeted changes; use `Write` only for a full rewrite.

5. **Report.** If you changed the file, begin your output with the line
   `FILE UPDATED ON DISK: <path> — re-read before further edits; any earlier view is stale.`
   (substitute the real path), then a 1–5 bullet summary of the changes. If you
   made no changes, output `no changes — advisor raised nothing actionable`. The
   main thread relays your output. Do not invoke any other skill — file-advisor-improver
   is terminal.
