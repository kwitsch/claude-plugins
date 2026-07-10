---
name: dream
description: Consolidate this project's auto-memory files (~/.claude/projects/<project>/memory/) in four phases -- orient, gather signal from recent session transcripts, consolidate (merge duplicates, drop stale entries, resolve contradictions), update the MEMORY.md index. Compresses touched detail files caveman-style. Surgical -- only touches files that need a change. Trigger on natural language such as "dream", "run a dream", "dream cycle", "consolidate my memory", "clean up my memory files" -- no slash command needed.
allowed-tools: Read, Write, Edit, Bash, Skill, AskUserQuestion
---

# dream — memory consolidation cycle

Four phases, run in order. Surgical: a file that needs no change is left
byte-for-byte alone — this is not a rewrite-every-run pass.

## Phase 1 — Orient

Locate the memory directory from this session's own auto-memory
system-prompt block (the line stating "persistent, file-based memory system
at `<path>`") — never recompute it from `cwd`. If that block is absent this
session (auto-memory disabled, or an older Claude Code without the feature):
check `autoMemoryEnabled`/`autoMemoryDirectory` across `.claude/settings.local.json`
(project), `.claude/settings.json` (project), `~/.claude/settings.json` (user)
in that precedence order; if still nothing, fall back to the documented
default `~/.claude/projects/<project>/memory/`. If auto-memory is disabled
entirely, report that and stop — nothing to dream about.

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
contradiction gets noted in the file itself rather than blocking or asking):

1. Copy the pre-dream version to a sibling `<file>.bak` next to it (backup
   "daneben", not session-temp — this is dream's own backup, separate from
   `cc-compress`'s).
2. Write the consolidated content.
3. If the file is anything **other than** `MEMORY.md`: before compressing,
   note every `[[wikilink]]`-style cross-reference and bare-`.md` link
   target in the file. Then invoke `claude-code-knowledge:cc-compress`
   (Skill tool) on it with `--confirmed` (memory files live outside any git
   repo, so `cc-compress`'s own git-recoverability gate would otherwise ask
   every time; this dream cycle's own step-1 backup already covers
   rollback). After compressing, diff those noted references against the
   compressed result — `cc-compress`'s path-preservation check does not
   protect bare filenames or `[[...]]` tokens, only slash-containing paths
   and full URLs. If any reference was reworded or dropped, discard the
   compressed result and keep the consolidated-but-uncompressed version
   instead; note the skip in the session summary.

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

## Report

One short summary: files merged/dropped/changed, files left untouched, files
compressed vs. skipped (with why), and the final `MEMORY.md` line count.
