---
name: self-improvement
description: Reflect on this session's own tool calls and reasoning to find concrete, non-obvious ways the task could have been solved faster or more efficiently, report a plain-English summary to the user, and save durable lessons as feedback memory (deduped against existing entries) so future sessions benefit. Runs inline over the conversation already in context -- never forks, since an isolated subagent has no session history to reflect on. Trigger on an explicit ask for a retro/efficiency review of the current session, or right after wrapping up a nontrivial multi-step task -- not on trivial one-liners with nothing to learn from.
allowed-tools: Read, Write, Edit
---

# self-improvement -- session efficiency retro

Never fork this skill (`context: fork` has no session history to reflect
on). Begin at Step 1.

## Step 1 -- Reflect

Answer, using your own reasoning over the tool calls and thinking already in
this conversation (do not re-read the raw session transcript file), this
fixed prompt:

> Given all the tool calls here, the thinking you have done in this session,
> what are ways that you could have arrived at the solution far faster and
> more efficient?

Look for concrete, specific inefficiencies: redundant or repeated tool
calls, exploration a more targeted search/tool choice would have skipped,
back-and-forth a single upfront question would have avoided, over-broad
reads, retries a different first attempt would have avoided. Skip generic,
non-actionable observations ("could have been faster" with no identifiable
cause) -- if there's nothing concrete, say so in Step 2 rather than
inventing filler.

## Step 2 -- Summarize to the user

Output the reflection as a plain-text message with concrete bullets (not a
wall of prose). Always happens, whether or not anything is saved as
memory.

## Step 3 -- Save durable findings as memory

Mirrors `dream`'s own orient/backup/two-step-save/index protocol -- keep
the two in parity if either changes.

For each concrete, generalizable lesson from Step 1 (the kind that would
help a *future* session, not a one-off fact about this task) that also
clears the auto-memory system prompt's own "What NOT to save" list (no
task-specific facts, no derivable code patterns/architecture, nothing
already documented in a CLAUDE.md, no ephemeral/in-progress state):

1. **Orient.** Locate the memory directory from this session's own
   auto-memory system-prompt block (the "persistent, file-based memory
   system at `<path>`" line) -- never recompute it from `cwd` or read
   `.claude/settings*.json`. Absent this session -> report that memory's
   location can't be determined and stop here (Step 2's summary already
   stands on its own).
2. **Dedup check (hard gate).** Read `MEMORY.md` and this skill's own
   running memory file, `feedback_self_improvement_efficiency.md`, if it
   exists, *before* writing anything. A candidate lesson already captured
   (even paraphrased) is **not** written again -- merge into the existing
   bullet at most (e.g. tightening its wording), never append a
   near-duplicate.
3. **Write.** If `feedback_self_improvement_efficiency.md` already
   exists, Read it and Write a copy to
   `feedback_self_improvement_efficiency.md.bak` first, then write the
   merged content. If it doesn't exist yet, author it fresh via this
   session's own auto-memory two-step save process: frontmatter `name:
   self-improvement-efficiency`, `description:` one line,
   `metadata.type: feedback`; body structured per lesson as **Why:** /
   **How to apply:** lines. State plainly in the body that these are
   self-derived retrospective findings from Claude's own analysis, not
   user-issued corrections.
4. **Index.** Add the one-line `MEMORY.md` pointer for the file if it was
   newly created this run; leave `MEMORY.md` untouched if the file
   already existed and only its content changed. Before adding, confirm
   `MEMORY.md` stays under its 200-line/25KB load cutoff (content beyond
   this never loads at session start) -- if adding the line would exceed
   it, skip the index add, note the skip in the final report, and leave
   re-deriving the index to a future `dream` cycle.
5. **No findings** -> skip all of the above silently; Step 2 already
   communicated that.

## Report

One short final message: the Step 2 summary (always), plus -- if
anything was saved -- which file and a one-line description of what was
added.
