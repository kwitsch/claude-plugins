---
name: dream
description: Consolidate this project's auto-memory files (~/.claude/projects/<project>/memory/) in four phases -- orient, gather signal from recent session transcripts, consolidate (merge duplicates, drop stale entries, resolve contradictions, author a new memory file for any signal with no existing memory home), update the MEMORY.md index. Optionally compresses touched detail files caveman-style via claude-code-knowledge's cc-compress when that plugin is enabled (silent no-op otherwise). Surgical -- only touches files that need a change. When coding-toolbox is installed and its tool-routing rule already exists, also refreshes that rule (silent no-op otherwise). Trigger on natural language such as "dream", "run a dream", "dream cycle", "consolidate my memory", "clean up my memory files", "did I forget to save something as memory", "check for missed learnings" -- no slash command needed.
allowed-tools: Read, Write, Edit, Bash, Skill, AskUserQuestion
---

# dream — memory consolidation cycle

Four required phases, run in order, plus one optional Phase 5. Surgical: a
file that needs no change is left byte-for-byte alone — this is not a
rewrite-every-run pass.

## Phase 1 — Orient

Locate the memory directory from this session's own auto-memory
system-prompt block (the line stating "persistent, file-based memory system
at `<path>`") — never recompute it from `cwd`, and never read
`.claude/settings*.json` or `~/.claude/settings.json` to search for it (those
files can carry unrelated credentials/config that has no business in this
skill's context). If that block is absent this session (auto-memory
disabled, or an older Claude Code without the feature), report that
auto-memory's location cannot be determined this way and stop — nothing to
dream about.

Read `MEMORY.md` and list every topic file in the memory directory.

## Phase 2 — Gather signal

`<project-dir>` = the parent of the memory directory (same directory that
holds this project's own `<uuid>.jsonl` session transcripts). Using `rg`
(ripgrep), scan the **8 most recent** `<project-dir>/*.jsonl` files (sorted
by mtime, descending) — main-session transcripts only, never subagent
transcripts under `<uuid>/subagents/` — for targeted correction/preference/
decision markers. Never fully read a transcript file. Example keyword set
(bilingual, case-insensitive, extend as useful — this is a starting point
not an exhaustive list): `no,|don't|instead|actually|stop doing|nein|nicht|
eigentlich|stattdessen|merke dir|remember that|from now on`. Note any hits
that look like a real correction, preference change, decision, or recurring
pattern worth reflecting in memory.

## Phase 3 — Consolidate

For each memory file that needs a change based on phase 1's read and phase
2's signal — merge duplicate memories, drop stale or superseded entries,
resolve contradictions preferring the most recent evidence (an unresolvable
contradiction gets noted in the file itself rather than blocking or asking).
This includes authoring a brand-new file for any phase 2 signal with no
existing memory home — a correction, preference, or decision with no file
to fold into — via this session's own auto-memory system prompt's two-step
save process (pick the fitting type: user/feedback/project/reference; write
frontmatter `name`/`description`/`metadata.type`; for feedback/project
types structure the body with **Why:** and **How to apply:** lines):

1. If the file already exists, copy the pre-dream version to a sibling
   `<file>.bak` next to it (backup "daneben", not session-temp — this is
   dream's own backup, separate from `cc-compress`'s). A brand-new file has
   nothing to back up — skip this step for it.
2. Write the consolidated (or newly-authored) content.
3. If the file is anything **other than** `MEMORY.md`: check whether
   `claude-code-knowledge:cc-compress` is among this session's available
   skills (no hard dependency — `claude-code-knowledge` is an optional
   integration). **Not available → silent no-op**: keep the
   consolidated-but-uncompressed content as final, no note in the summary,
   no different from a cycle that never attempted compression. **Available →**
   copy the just-written consolidated content to a second sibling backup,
   `<file>.pre-compress.bak` (distinct from the pre-dream `.bak` — this is
   the actual rollback point for a failed compression; restoring from the
   pre-dream `.bak` instead would silently discard this cycle's
   consolidation work). Extract the file's reference set with `rg -o
   '\[\[[^]]+\]\]|\b[\w-]+\.md\b' <file> | sort -u` (wikilinks plus
   bare-`.md` filenames — `cc-compress`'s path-preservation check does not
   protect either, only slash-containing paths and full URLs). Invoke
   `claude-code-knowledge:cc-compress` (Skill tool) on it with `--confirmed`
   (memory files live outside any git repo, so `cc-compress`'s own
   git-recoverability gate would otherwise ask every time; this dream
   cycle's own backups already cover rollback). After compressing, run the
   same `rg -o ... | sort -u` command against the compressed result and
   `diff` the two sorted lists. Any difference (a missing or altered entry)
   → restore the file from `<file>.pre-compress.bak` (not the pre-dream
   `.bak`), and note *that* skip in the session summary (this one is a real,
   file-specific finding — unlike `cc-compress` simply being unavailable).
   Either way (compression accepted or rolled back), delete
   `<file>.pre-compress.bak` once its job is done — only the pre-dream
   `.bak` persists as the lasting rollback record.

Files that need no change: leave alone entirely — do not open, backup, or
touch them.

## Phase 4 — Update the MEMORY.md index

Re-derive `MEMORY.md` from the current set of memory files (after phase 3's
changes), one line per entry: `- [Title](file.md) — one-line hook`. Keep it
under **200 lines / 25KB** (the documented load cutoff — content beyond this
never loads at session start). Write it directly — **do not** run it through
`cc-compress`: its bullets are bare-filename markdown links with no leading
path separator, which is exactly the gap phase 3 step 3 works around for
other files, and there is no backup-and-diff step protecting the index
itself, so it must never risk a reworded filename.

## Phase 5 — Sync coding-toolbox tools rule (optional)

Gate: `coding-toolbox:refresh-tools-rule` is among this session's available
skills (same presence check as the `claude-code-knowledge:cc-compress` check
in phase 3) — a narrow, non-destructive companion to `coding-toolbox:setup-rules`
that only ever refreshes an *already-installed*
`~/.claude/rules/coding-toolbox-tools.md`, never installs or removes it.
Absent → skip; note that in the Report line below (a one-line note, not
additional summary detail).

Available → `Skill(coding-toolbox:refresh-tools-rule)` — one call, no
arguments (there is nothing to choose), no follow-up question. That skill's
own internal gate handles "not installed yet" as a safe no-op, so dream
itself never checks for the file's existence or installs it.

## Report

One short summary: files merged/dropped/changed/created, files left
untouched, files compressed vs. rolled back after a failed compression (with
why — cc-compress simply being unavailable is not itself called out, per
phase 3), the final `MEMORY.md` line count, and whether the coding-toolbox
tools rule was refreshed, left untouched, or skipped (with why).
